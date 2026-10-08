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
  rules: number;
}

const none = (): IbanHashMigration => ({
  accounts: 0,
  movements: 0,
  fingerprintsKept: 0,
  payerAccounts: 0,
  rules: 0,
});

/** Rows holding a hash that is not keyed: not null, and without the prefix. */
const plain = { not: null } as const;
const notKeyed = { ibanHash: { startsWith: KEYED_IBAN_HASH_PREFIX } };

export async function migrateIbanHashes(): Promise<IbanHashMigration> {
  if (!ibanHashKeyConfigured()) return { ...none(), skipped: "no_key" };

  const prisma = getPrismaClient();
  const result = none();

  for (;;) {
    const rows = await prisma.bankAccount.findMany({
      where: { ibanHash: plain, NOT: notKeyed },
      select: { id: true, ibanHash: true },
      take: BATCH,
    });
    // Only what converting would change: a batch with nothing to change would be read again forever.
    const pending = rows.filter((row) => keyedIbanHash(row.ibanHash as string) !== row.ibanHash);
    if (pending.length === 0) break;
    const done = await prisma.$transaction(
      pending.map((row) =>
        prisma.bankAccount.updateMany({
          where: { id: row.id, ibanHash: row.ibanHash },
          data: { ibanHash: keyedIbanHash(row.ibanHash as string) },
        }),
      ),
    );
    const changed = done.reduce((sum, r) => sum + r.count, 0);
    result.accounts += changed;
    if (changed === 0) break;
  }

  for (;;) {
    const rows = await prisma.bankTransaction.findMany({
      where: {
        counterpartyIbanHash: plain,
        NOT: { counterpartyIbanHash: { startsWith: KEYED_IBAN_HASH_PREFIX } },
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

    const updates = pending.map((row) => {
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
      if (!reproducible) result.fingerprintsKept += 1;
      return prisma.bankTransaction.updateMany({
        where: { id: row.id, counterpartyIbanHash: oldHash },
        data: {
          counterpartyIbanHash: newHash,
          ...(reproducible
            ? { fingerprint: computeFingerprint({ ...fields, counterpartyIbanHash: newHash }) }
            : {}),
        },
      });
    });
    const changed = (await prisma.$transaction(updates)).reduce((sum, r) => sum + r.count, 0);
    result.movements += changed;
    if (changed === 0) break;
  }

  for (;;) {
    const rows = await prisma.payerAccount.findMany({
      where: { NOT: notKeyed },
      select: { id: true, ibanHash: true },
      take: BATCH,
    });
    const pending = rows.filter((row) => keyedIbanHash(row.ibanHash) !== row.ibanHash);
    if (pending.length === 0) break;
    const done = await prisma.$transaction(
      pending.map((row) =>
        prisma.payerAccount.updateMany({
          where: { id: row.id, ibanHash: row.ibanHash },
          data: { ibanHash: keyedIbanHash(row.ibanHash) },
        }),
      ),
    );
    const changed = done.reduce((sum, r) => sum + r.count, 0);
    result.payerAccounts += changed;
    if (changed === 0) break;
  }

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

  return result;
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
