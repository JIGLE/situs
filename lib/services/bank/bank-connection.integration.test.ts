import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BankRow } from "./rows";
import type { FakeProvider } from "./providers/fake-provider";

/**
 * The live bank connection, end to end, against a real SQLite file.
 *
 * WHY THIS EXISTS ALONGSIDE THE UNIT TESTS. `consent.test.ts` and `sync.test.ts` mock Prisma, so
 * they prove the code calls the right methods with the right arguments — and nothing more. Three of
 * this feature's load-bearing guarantees are enforced by the DATABASE, not by the code, and are
 * therefore invisible to a mocked client:
 *
 *   - `BankTransaction.fingerprint` is `@unique`. Re-importing a statement is idempotent because
 *     SQLite refuses the second row, not because a mock said `findUnique` returned something.
 *   - `BankAccount` is `@@unique([connectionId, ibanHash])`. Reconnecting the same bank updates the
 *     existing account instead of splitting its movement history across two rows.
 *   - Every owned row foreign-keys to `User`. A connection written against a userId that does not
 *     exist fails at the constraint — the exact class of bug that shipped in `fix(auth)` this week.
 *
 * It also proves the piece no unit test can: that `importBankRows`' `target` really attributes a
 * synced movement to the provider connection rather than the find-or-created "Manual import" one.
 *
 * ONLY the provider is faked, at the published `BankDataProvider` boundary. Prisma, SQLite, the
 * schema, the constraints, the consent service, the sync orchestration and the whole import
 * pipeline are real. This used to stub `fetch` and route one vendor's URLs, which quietly made a
 * pipeline test depend on a vendor's JSON staying still.
 */
describe("live bank connection — real Prisma client + real SQLite file", () => {
  let tempDir: string;
  let dbUrl: string;
  let userId: string;

  /** The fake provider's own read budget — a provider term, not a global constant. */
  const DAILY_BUDGET = 4;

  /**
   * Rows exactly as a provider hands them over. There is no HTTP here and no vendor payload to
   * map: this file used to stub `fetch` and route one vendor's URLs, which meant the pipeline's
   * properties — consent scoping, the read budget, fingerprint dedupe, the IBAN encrypted at rest
   * — were asserted through an adapter that could change under them. A fake implementing the
   * published contract keeps the subject of the test the thing being tested.
   */
  const ROWS: BankRow[] = [
    {
      bookingDate: "2026-08-01",
      amount: 750,
      counterpartyName: "Ana Silva",
      counterpartyIban: "PT50000201239999999999999",
      reference: "RENDA AGOSTO",
    },
    {
      bookingDate: "2026-08-02",
      amount: -120.5,
      counterpartyName: "EDP Comercial",
      reference: "FATURA LUZ",
    },
  ];

  const REMOTE_ACCOUNT_ID = "remote-account-1";
  const IBAN = "PT50000201231234567890154";

  let transactionRows: BankRow[] = ROWS;
  let failTransactionsWith: Error | null = null;
  let unregister: (() => void) | null = null;
  /** The case's fake, kept so a case can read what the bank was asked to revoke. */
  let fake: FakeProvider;

  beforeAll(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "situs-bank-test-"));
    dbUrl = `file:${path.join(tempDir, "test.db")}`;

    // No `--accept-data-loss`: a fresh file has nothing to lose, so the push needs no such consent.
    // Prisma refuses the flag outright when an AI agent runs it, which kept this file from running
    // there.
    execSync(`npx prisma db push --url="${dbUrl}"`, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = dbUrl;
    process.env.PII_ENCRYPTION_KEY = "c".repeat(64);
    process.env.NEXTAUTH_URL = "https://situs.test";
  }, 90_000);

  afterAll(async () => {
    const { resetPrismaClientForTests } = await import("../database/database");
    resetPrismaClientForTests();
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  beforeEach(async () => {
    transactionRows = ROWS;
    failTransactionsWith = null;

    // Registered into the real registry, so consent and sync resolve it exactly as they would a
    // shipped adapter — including `psd2_<key>` in the provider column.
    const { createFakeProvider } = await import("./providers/fake-provider");
    const { __registerProviderForTest } = await import("./providers/registry");
    const base = createFakeProvider({
      key: "fake",
      dailyReadBudget: DAILY_BUDGET,
      accounts: [{ id: REMOTE_ACCOUNT_ID, iban: IBAN, currency: "EUR", label: "Conta ordenado" }],
    });
    fake = base;
    unregister = __registerProviderForTest({
      ...base,
      async fetchTransactions(accountRef: string, since?: Date) {
        if (failTransactionsWith) throw failTransactionsWith;
        await base.fetchTransactions(accountRef, since);
        return transactionRows;
      },
    });

    // A real User row: every owned record foreign-keys to it, so this is what makes the FK
    // constraints below meaningful rather than decorative.
    const { getPrismaClient, resetPrismaClientForTests } = await import("../database/database");
    resetPrismaClientForTests();
    const prisma = getPrismaClient();
    const user = await prisma.user.create({
      data: { email: `owner-${Date.now()}-${Math.random()}@situs.test`, role: "ADMIN" },
    });
    userId = user.id;
  });

  async function connectAndAuthorise() {
    const { startConsent, completeConsent } = await import("./consent");
    const { getPrismaClient } = await import("../database/database");
    const prisma = getPrismaClient();

    const started = await startConsent(userId, {
      country: "PT",
      institutionId: "FAKEBANK_PT",
      institutionName: "Fake Bank",
      providerKey: "fake",
    });

    const pending = await prisma.bankConnection.findUniqueOrThrow({
      where: { id: started.connectionId },
    });
    const reference = JSON.parse(pending.metadata ?? "{}").reference as string;

    await completeConsent(userId, reference);
    return started.connectionId;
  }

  it("persists the consent, encrypts the IBAN and keeps a hash for matching", async () => {
    const connectionId = await connectAndAuthorise();
    const { getPrismaClient } = await import("../database/database");
    const prisma = getPrismaClient();

    const connection = await prisma.bankConnection.findUniqueOrThrow({
      where: { id: connectionId },
      include: { accounts: true },
    });

    expect(connection.status).toBe("active");
    expect(connection.provider).toBe("psd2_fake");
    expect(connection.accounts).toHaveLength(1);

    const account = connection.accounts[0];

    // The IBAN is ciphertext at rest and STAYS ciphertext on read. `BankAccount` is deliberately
    // not in PII_FIELDS, so the Prisma extension does not decrypt it; consent.ts encrypts at the
    // call site and nothing anywhere decrypts a bank IBAN. Matching uses the hash, display uses
    // last4. Asserting a round-trip here would have been asserting a convenience; asserting that
    // the plaintext is unrecoverable asserts the security property.
    expect(account.iban).toMatch(/^enc:/);
    expect(account.iban).not.toContain(IBAN);

    // …and the two fields that ARE meant to be usable.
    expect(account.ibanHash).toMatch(/^[0-9a-f]{64}$/);
    expect(account.ibanLast4).toBe("0154");

    // The hash is the matcher's key, so it must be the hash OF the real IBAN, not of the
    // ciphertext — otherwise a synced account would never match a movement.
    const { hashIban } = await import("./import");
    expect(account.ibanHash).toBe(hashIban(IBAN));

    // The spent reference is gone and the provider account id recorded in its place.
    const metadata = JSON.parse(connection.metadata ?? "{}");
    expect(metadata.reference).toBeUndefined();
    expect(metadata.accountRefs[account.id]).toBe(REMOTE_ACCOUNT_ID);
  });

  it("attributes synced movements to the provider connection, not the manual one", async () => {
    const connectionId = await connectAndAuthorise();
    const { syncConnection } = await import("./sync");
    const { getPrismaClient } = await import("../database/database");
    const prisma = getPrismaClient();

    const result = await syncConnection(userId, connectionId);
    expect(result.accountsChecked).toBe(1);

    const movements = await prisma.bankTransaction.findMany({
      where: { userId },
      include: { bankAccount: { include: { connection: true } } },
      orderBy: { bookingDate: "asc" },
    });

    expect(movements).toHaveLength(2);
    for (const m of movements) {
      expect(m.bankAccount.connection.id).toBe(connectionId);
      expect(m.bankAccount.connection.provider).toBe("psd2_fake");
    }

    // Rows land intact: sign, counterparty and reference survive the pipeline unchanged.
    expect(movements[0].amount).toBe(750);
    expect(movements[0].counterpartyName).toBe("Ana Silva");
    expect(movements[1].amount).toBe(-120.5);
    expect(movements[1].counterpartyName).toBe("EDP Comercial");
    expect(movements[1].reference).toBe("FATURA LUZ");

    // No "Manual import" connection was created — that is what `target` is for.
    const manual = await prisma.bankConnection.findFirst({ where: { userId, provider: "manual" } });
    expect(manual).toBeNull();
  });

  it("is idempotent against the real unique constraint, not a mocked lookup", async () => {
    const connectionId = await connectAndAuthorise();
    const { syncConnection } = await import("./sync");
    const { getPrismaClient } = await import("../database/database");
    const prisma = getPrismaClient();

    const first = await syncConnection(userId, connectionId);
    const second = await syncConnection(userId, connectionId);

    expect(first.summaries[0].imported).toBe(2);
    expect(second.summaries[0].imported).toBe(0);
    expect(second.summaries[0].duplicates).toBe(2);

    // The database is the arbiter: still two rows after two syncs of the same statement.
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(2);
  });

  it("renews a connection in place, so its accounts keep their ids and nothing imports twice", async () => {
    const connectionId = await connectAndAuthorise();
    const { syncConnection } = await import("./sync");
    const { completeConsent, startRenewal } = await import("./consent");
    const { getPrismaClient } = await import("../database/database");
    const prisma = getPrismaClient();

    const first = await syncConnection(userId, connectionId);
    expect(first.summaries[0].imported).toBe(2);
    const before = await prisma.bankConnection.findUniqueOrThrow({
      where: { id: connectionId },
      include: { accounts: true },
    });

    // Renewing used to mean connecting again: a second connection with its own account rows, so a
    // movement seen through both missed exact deduplication and waited in review.
    await startRenewal(userId, connectionId);
    const parked = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const reference = JSON.parse(parked.metadata ?? "{}").renewal.reference as string;
    await expect(completeConsent(userId, reference)).resolves.toMatchObject({ renewal: true });

    const after = await prisma.bankConnection.findUniqueOrThrow({
      where: { id: connectionId },
      include: { accounts: true },
    });
    expect(await prisma.bankConnection.count({ where: { userId } })).toBe(1);
    expect(after.accounts.map((account) => account.id)).toEqual(
      before.accounts.map((account) => account.id),
    );
    expect(after.status).toBe("active");
    expect(after.consentId).toBeTruthy();
    expect(after.consentId).not.toBe(before.consentId);
    // The old consent is ended at the bank, once the new one is stored.
    expect(fake.revocations).toEqual([before.consentId]);

    const second = await syncConnection(userId, connectionId);
    expect(second.summaries[0].imported).toBe(0);
    expect(second.summaries[0].duplicates).toBe(2);
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(2);

    // Spent: the same reference cannot complete twice.
    await expect(completeConsent(userId, reference)).rejects.toMatchObject({ status: 404 });
  });

  it("disconnects a connection: its movements stay, the bank is told and the daily run skips it", async () => {
    const connectionId = await connectAndAuthorise();
    const { syncConnection, syncAllDueConnections, ConnectionNotSyncableError } =
      await import("./sync");
    const { disconnectConnection } = await import("./connections");
    const { getPrismaClient } = await import("../database/database");
    const prisma = getPrismaClient();

    await syncConnection(userId, connectionId);
    const before = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });

    await expect(disconnectConnection(userId, connectionId)).resolves.toMatchObject({
      revocation: "revoked",
    });

    const after = await prisma.bankConnection.findUniqueOrThrow({
      where: { id: connectionId },
      include: { accounts: true },
    });
    expect(after.status).toBe("revoked");
    expect(after.consentId).toBeNull();
    expect(fake.revocations).toEqual([before.consentId]);
    // The owner's records stay: the account and every movement it brought.
    expect(after.accounts).toHaveLength(1);
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(2);

    // Tomorrow's run picks up every active connection; it passes this one by.
    await syncAllDueConnections(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const later = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(later.lastSyncAt?.getTime()).toBe(after.lastSyncAt?.getTime());
    await expect(syncConnection(userId, connectionId)).rejects.toBeInstanceOf(
      ConnectionNotSyncableError,
    );
  });

  it("removes a connection only while it has brought no movements", async () => {
    const { removeConnection } = await import("./connections");
    const { syncConnection } = await import("./sync");
    const { getPrismaClient } = await import("../database/database");
    const prisma = getPrismaClient();

    // Before any sync there is nothing to lose: it goes, and its consent ends at the bank.
    const empty = await connectAndAuthorise();
    const { consentId } = await prisma.bankConnection.findUniqueOrThrow({ where: { id: empty } });
    await expect(removeConnection(userId, empty)).resolves.toMatchObject({
      revocation: "revoked",
    });
    expect(await prisma.bankConnection.findUnique({ where: { id: empty } })).toBeNull();
    expect(await prisma.bankAccount.count({ where: { connectionId: empty } })).toBe(0);
    expect(fake.revocations).toEqual([consentId]);

    // After a sync its movements are the owner's records: refused, and nothing is deleted.
    const synced = await connectAndAuthorise();
    await syncConnection(userId, synced);
    await expect(removeConnection(userId, synced)).rejects.toMatchObject({
      reason: "bank_connection_has_movements",
    });
    expect(await prisma.bankConnection.findUnique({ where: { id: synced } })).not.toBeNull();
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(2);
  });

  it("counts the day's reads from persisted jobs and then refuses", async () => {
    const connectionId = await connectAndAuthorise();
    const { syncConnection, SyncBudgetExceededError } = await import("./sync");

    for (let i = 0; i < DAILY_BUDGET; i += 1) {
      await syncConnection(userId, connectionId);
    }
    await expect(syncConnection(userId, connectionId)).rejects.toBeInstanceOf(
      SyncBudgetExceededError,
    );
  });

  it("marks the connection expired when the consent lapses mid-sync", async () => {
    const connectionId = await connectAndAuthorise();
    const { syncConnection } = await import("./sync");
    const { ConsentExpiredError } = await import("./providers/types");
    const { getPrismaClient } = await import("../database/database");
    const prisma = getPrismaClient();

    failTransactionsWith = new ConsentExpiredError();

    await expect(syncConnection(userId, connectionId)).rejects.toBeInstanceOf(ConsentExpiredError);

    const connection = await prisma.bankConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    // Persisted, not just returned — the UI and /admin read this column.
    expect(connection.status).toBe("expired");

    // And a lapsed consent is not a quiet zero: no movements were recorded for it.
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(0);
  });

  it("still lists a completed test run as one, so /admin can show and delete it", async () => {
    const { startConsent, completeConsent } = await import("./consent");
    const { listTestConnections } = await import("./test-connections");
    const { getPrismaClient } = await import("../database/database");
    const prisma = getPrismaClient();

    const started = await startConsent(userId, {
      country: "PT",
      institutionId: "FAKEBANK_PT",
      institutionName: "Fake Bank",
      providerKey: "fake",
      isTest: true,
    });
    const pending = await prisma.bankConnection.findUniqueOrThrow({
      where: { id: started.connectionId },
    });
    await completeConsent(userId, JSON.parse(pending.metadata ?? "{}").reference as string);

    // Completing the consent used to overwrite the metadata with the account refs alone.
    const listed = await listTestConnections(userId);
    expect(listed.map((row) => row.id)).toEqual([started.connectionId]);
    expect(listed[0].status).toBe("active");
  });

  it("refuses to sync a connection belonging to someone else", async () => {
    const connectionId = await connectAndAuthorise();
    const { syncConnection, ConnectionNotSyncableError } = await import("./sync");
    const { getPrismaClient } = await import("../database/database");
    const prisma = getPrismaClient();

    const other = await prisma.user.create({
      data: { email: `intruder-${Date.now()}@situs.test`, role: "ADMIN" },
    });

    await expect(syncConnection(other.id, connectionId)).rejects.toBeInstanceOf(
      ConnectionNotSyncableError,
    );
  });
});
