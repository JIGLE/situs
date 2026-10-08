import { getPrismaClient } from "@/lib/services/database/database";
import { logger } from "@/lib/utils/logger";
import {
  KEYED_IBAN_HASH_PREFIX,
  ibanHashKeyConfigured,
  isKeyedIbanHash,
  keyedIbanHash,
} from "@/lib/utils/iban-hash";
import { computeFingerprint } from "@/lib/services/bank/import";

/**
 * Converts the IBAN hashes stored before they were keyed (`lib/utils/iban-hash.ts`).
 *
 * Every stored value H is the plain SHA-256 of an IBAN, and the keyed value is a function of H alone,
 * so nothing here reads an IBAN: `BankAccount.iban` stays encrypted and unread, and a hash whose IBAN
 * is held nowhere (a remembered payer account) converts all the same. Five places hold one:
 *
 *   - `BankAccount.ibanHash`;
 *   - `BankTransaction.counterpartyIbanHash`, and that movement's `fingerprint`, which is a hash of
 *     the row's fields INCLUDING the IBAN hash, so left alone it would still let anyone with the file
 *     test an IBAN guess against it. It is rebuilt from the row's own fields, and only after the old
 *     one is rebuilt the same way and found equal to what is stored: a fingerprint that cannot be
 *     reproduced is left as it is rather than replaced by a guess, since a wrong one would let the
 *     same movement be imported twice;
 *   - `PayerAccount.ibanHash`;
 *   - an `iban_hash` reconciliation rule's value.
 *
 * Idempotent and resumable: it touches only values without the `v2:` prefix, each update says which
 * value it expects to find, and it stops at nothing half-done that the next run cannot finish. It runs
 * at every start (`instrumentation.ts`), which is also what converts a backup restored from before.
 * With no key there is nothing to convert to, and it does nothing.
 *
 * One row at a time, so one row that cannot be converted does not stop the rest. It cannot be when
 * the keyed value is already stored beside it (a backup restored into a running server, then the
 * same account connected again): a remembered payer account is then a duplicate and is removed, and
 * a bank account or a movement is left as it is, counted in `conflicts` and named in the log.
 *
 * SQLite keeps what an UPDATE replaced in free pages and in the write-ahead log, where the plain
 * hashes would stay readable to anyone with a copy of the file, so after a conversion the log is
 * checkpointed and the file vacuumed. A backup taken before the upgrade still holds them: it is a
 * copy, and keeping it is the operator's choice (docs/SECURITY.md).
 */

const BATCH = 200;

export interface IbanHashMigration {
  /** Why nothing was done, when nothing was. */
  skipped?: "no_key";
  accounts: number;
  movements: number;
  /** Movements whose fingerprint could not be reproduced from their own fields, and so was kept. */
  fingerprintsKept: number;
  payerAccounts: number;
  /** Remembered payer accounts removed because the same account was already stored keyed. */
  duplicatesRemoved: number;
  rules: number;
  /** Rows left as they were because the keyed value is already taken by another row. */
  conflicts: number;
  /** Whether the old values were then cleared from the file (checkpoint and vacuum). */
  scrubbed?: boolean;
}

const none = (): IbanHashMigration => ({
  accounts: 0,
  movements: 0,
  fingerprintsKept: 0,
  payerAccounts: 0,
  duplicatesRemoved: 0,
  rules: 0,
  conflicts: 0,
});

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === "P2002";

/** Rows holding a hash that is not keyed: not null, and without the prefix. */
const plain = { not: null } as const;
const notKeyed = { ibanHash: { startsWith: KEYED_IBAN_HASH_PREFIX } };

export async function migrateIbanHashes(): Promise<IbanHashMigration> {
  if (!ibanHashKeyConfigured()) return { ...none(), skipped: "no_key" };

  const prisma = getPrismaClient();
  const result = none();

  // --- Bank accounts.
  const skippedAccounts: string[] = [];
  for (;;) {
    const rows = await prisma.bankAccount.findMany({
      where: { ibanHash: plain, NOT: notKeyed, id: { notIn: skippedAccounts } },
      select: { id: true, ibanHash: true },
      take: BATCH,
    });
    // Only what converting would change: a batch with nothing to change would be read again forever.
    const pending = rows.filter((row) => keyedIbanHash(row.ibanHash as string) !== row.ibanHash);
    if (pending.length === 0) break;
    for (const row of pending) {
      try {
        const done = await prisma.bankAccount.updateMany({
          where: { id: row.id, ibanHash: row.ibanHash },
          data: { ibanHash: keyedIbanHash(row.ibanHash as string) },
        });
        result.accounts += done.count;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        skippedAccounts.push(row.id);
        result.conflicts += 1;
      }
    }
  }

  // --- Movements, and their fingerprints.
  const skippedMovements: string[] = [];
  for (;;) {
    const rows = await prisma.bankTransaction.findMany({
      where: {
        counterpartyIbanHash: plain,
        NOT: { counterpartyIbanHash: { startsWith: KEYED_IBAN_HASH_PREFIX } },
        id: { notIn: skippedMovements },
      },
      select: {
        id: true,
        fingerprint: true,
        bankAccountId: true,
        amount: true,
        bookingDate: true,
        counterpartyIbanHash: true,
        counterpartyName: true,
        reference: true,
      },
      take: BATCH,
    });
    const pending = rows.filter(
      (row) => keyedIbanHash(row.counterpartyIbanHash as string) !== row.counterpartyIbanHash,
    );
    if (pending.length === 0) break;
    for (const row of pending) {
      const oldHash = row.counterpartyIbanHash as string;
      const newHash = keyedIbanHash(oldHash);
      const fields = {
        bankAccountId: row.bankAccountId,
        amount: row.amount,
        bookingDate: row.bookingDate.toISOString().slice(0, 10),
        counterpartyName: row.counterpartyName,
        reference: row.reference,
      };
      const reproducible =
        computeFingerprint({ ...fields, counterpartyIbanHash: oldHash }) === row.fingerprint;
      try {
        const done = await prisma.bankTransaction.updateMany({
          where: { id: row.id, counterpartyIbanHash: oldHash },
          data: {
            counterpartyIbanHash: newHash,
            ...(reproducible
              ? { fingerprint: computeFingerprint({ ...fields, counterpartyIbanHash: newHash }) }
              : {}),
          },
        });
        result.movements += done.count;
        if (!reproducible && done.count > 0) result.fingerprintsKept += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        skippedMovements.push(row.id);
        result.conflicts += 1;
      }
    }
  }

  // --- Remembered payer accounts.
  const skippedPayers: string[] = [];
  for (;;) {
    const rows = await prisma.payerAccount.findMany({
      where: { NOT: notKeyed, id: { notIn: skippedPayers } },
      select: { id: true, ibanHash: true },
      take: BATCH,
    });
    const pending = rows.filter((row) => keyedIbanHash(row.ibanHash) !== row.ibanHash);
    if (pending.length === 0) break;
    for (const row of pending) {
      try {
        const done = await prisma.payerAccount.updateMany({
          where: { id: row.id, ibanHash: row.ibanHash },
          data: { ibanHash: keyedIbanHash(row.ibanHash) },
        });
        result.payerAccounts += done.count;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // The tenant already has this account remembered under the keyed value: the same fact twice.
        const removed = await prisma.payerAccount.deleteMany({
          where: { id: row.id, ibanHash: row.ibanHash },
        });
        result.duplicatesRemoved += removed.count;
        skippedPayers.push(row.id);
      }
    }
  }

  // --- Reconciliation rules.
  const rules = await prisma.reconciliationRule.findMany({
    where: { condition: { contains: '"iban_hash"' } },
    select: { id: true, condition: true },
  });
  for (const rule of rules) {
    let condition: { field?: unknown; value?: unknown };
    try {
      condition = JSON.parse(rule.condition) as typeof condition;
    } catch {
      continue;
    }
    if (condition.field !== "iban_hash" || typeof condition.value !== "string") continue;
    if (isKeyedIbanHash(condition.value)) continue;
    const updated = await prisma.reconciliationRule.updateMany({
      where: { id: rule.id, condition: rule.condition },
      data: { condition: JSON.stringify({ ...condition, value: keyedIbanHash(condition.value) }) },
    });
    result.rules += updated.count;
  }

  const changed =
    result.accounts +
    result.movements +
    result.payerAccounts +
    result.duplicatesRemoved +
    result.rules;
  if (changed > 0) result.scrubbed = await scrubOldValues();

  if (result.conflicts > 0) {
    logger.error(
      "IBAN hashes of some rows could not be converted: the keyed value is already stored",
      {
        accounts: skippedAccounts,
        movements: skippedMovements,
      },
    );
  }
  return result;
}

/**
 * Clears what the conversion replaced from the file: the write-ahead log is folded in and truncated,
 * and the file is rebuilt without its free pages. Best effort, and said so when it fails.
 */
async function scrubOldValues(): Promise<boolean> {
  try {
    const prisma = getPrismaClient();
    await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    await prisma.$executeRawUnsafe("VACUUM");
    await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    return true;
  } catch (error) {
    logger.warn("Old IBAN hashes could not be cleared from the database file", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * The same, at server start. A failure is logged and does not stop the server: Admin › Status says
 * what is left (`ibanHashCheck`), and the next start finishes what this one could not.
 */
export async function runIbanHashMigrationAtStart(): Promise<void> {
  try {
    const result = await migrateIbanHashes();
    if (result.skipped) return;
    const changed = result.accounts + result.movements + result.payerAccounts + result.rules;
    if (changed > 0) {
      // `warn`, not `info`: production logs from `warn` up, and a one-time change to every stored
      // hash is what an operator reading the log after an upgrade should see.
      logger.warn("IBAN hashes converted to keyed hashes", { ...result });
    }
    if (result.fingerprintsKept > 0) {
      logger.warn("Some movements' fingerprints could not be rebuilt and were kept", {
        count: result.fingerprintsKept,
      });
    }
  } catch (error) {
    logger.error("IBAN hashes could not be converted; matching will not recognise old accounts", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
