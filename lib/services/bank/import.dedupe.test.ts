import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pins the fingerprint dedupe path in `importBankRows`.
 *
 * `fingerprint.test.ts` already proves `computeFingerprint` is a stable, discriminating hash.
 * That is a statement about a pure function — it says nothing about whether anything ACTS on
 * the hash. The path that consumes it had no test at all, and it is the only thing standing
 * between a re-uploaded bank statement and a tenant credited twice:
 *
 *   findUnique(fingerprint) → hit → duplicates++ and `continue`
 *
 * `continue` is doing a lot of work there. It skips the BankTransaction insert, the automation
 * Receipt, and the call to allocateReceipt. Delete those four lines and every existing test in
 * the repo still passes, while a second sync of the same movements silently doubles a tenant's
 * paid months.
 *
 * WHY THE MOCK HOLDS STATE. `bankTransaction` is backed by a Map keyed on fingerprint, so
 * `create` writes and `findUnique` reads it back. A stub that always returned null would pass
 * whether or not the guard existed — the green-but-inert shape this repo keeps producing. The
 * store is also what makes the within-a-single-batch case a real assertion rather than a
 * restatement of the mock.
 *
 * WHAT THIS DOES NOT DO. No SQL, so the `@unique` constraint on BankTransaction.fingerprint is
 * not exercised — only the application-level check that runs before it. The DB-backed test is
 * still open (P1 #4b), still blocked by Prisma's AI-agent guard.
 */

type TxnRow = { id: string; fingerprint: string; [key: string]: unknown };

const { prismaMock, store, resetStore } = vi.hoisted(() => {
  const store = { txns: new Map<string, TxnRow>(), nextId: 1 };

  const prismaMock = {
    bankConnection: {
      findFirst: vi.fn(async () => ({ id: "conn-1" })),
      // `importBankRows` reads the connection's metadata to decide whether these rows may cross
      // the allocation boundary — a test connection imports but never auto-allocates. An ordinary
      // import has no marker, so: no metadata.
      findUnique: vi.fn(async (): Promise<{ metadata: string | null }> => ({ metadata: null })),
      create: vi.fn(),
      update: vi.fn(),
    },
    bankAccount: {
      findFirst: vi.fn(async () => ({ id: "acct-1" })),
      create: vi.fn(),
    },
    bankSyncJob: {
      create: vi.fn(async () => ({ id: "job-1" })),
      update: vi.fn(),
    },
    bankTransaction: {
      // The Map IS the dedupe surface under test.
      findUnique: vi.fn(async ({ where }: { where: { fingerprint: string } }) => {
        return store.txns.get(where.fingerprint) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: TxnRow }) => {
        const row = { ...data, id: `txn-${store.nextId++}` };
        store.txns.set(data.fingerprint, row);
        return row;
      }),
      findMany: vi.fn(async (args?: { where?: Record<string, unknown> }) => {
        // Two different callers, two different answers.
        //
        // buildLeaseCandidates asks for previously matched movements that carry an IBAN hash,
        // and that hash is worth 0.45 of the confidence score. Without it this fixture tops out
        // at 0.55 (name .25 + amount .20 + reference .10) — under the 0.85 auto-match threshold
        // — the row lands in review, no receipt is created, and the "waterfall does not run
        // twice" assertion would compare 0 against 0 forever.
        if (args?.where?.counterpartyIbanHash) {
          return [
            {
              counterpartyIbanHash: KNOWN_IBAN_HASH,
              suggestedLeaseId: LEASE_ID,
              receipt: { leaseId: LEASE_ID },
            },
          ];
        }
        // The fuzzy-duplicate window. Empty on purpose: a near-miss here would push the row to
        // needs_review and we would be testing findPossibleDuplicate instead of the fingerprint.
        return [];
      }),
      update: vi.fn(),
    },
    lease: {
      findMany: vi.fn(async () => [
        {
          id: "lease-1",
          monthlyRent: 1250,
          tenant: { name: "Maria Silva" },
          property: { name: "Rua Augusta 12", address: "Lisboa" },
        },
      ]),
      findUniqueOrThrow: vi.fn(async () => ({ tenantId: "tenant-1", propertyId: "property-1" })),
    },
    rentPeriod: { findMany: vi.fn(async () => []) },
    reconciliationRule: { findMany: vi.fn(async () => []), update: vi.fn() },
    receipt: { create: vi.fn(async () => ({ id: "receipt-1" })) },
  };

  const resetStore = () => {
    store.txns.clear();
    store.nextId = 1;
  };

  return { prismaMock, store, resetStore };
});

const { allocateReceiptMock, logAuditMock } = vi.hoisted(() => ({
  allocateReceiptMock: vi.fn(),
  logAuditMock: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/services/allocation/service", () => ({ allocateReceipt: allocateReceiptMock }));
vi.mock("@/lib/utils/pii-encryption", () => ({ encryptPII: (v: string) => `enc:${v}` }));

import { importBankRows, hashIban } from "./import";
import type { BankRow } from "./rows";

const USER_ID = "user-1";
const LEASE_ID = "lease-1";
const TENANT_IBAN = "PT50000201231234567890154";
/** Referenced by the bankTransaction.findMany mock above, resolved at call time. */
const KNOWN_IBAN_HASH = hashIban(TENANT_IBAN);

/** One month's rent from a known tenant — the row a landlord's statement actually contains. */
const rentRow: BankRow = {
  bookingDate: "2026-06-01",
  amount: 1250,
  counterpartyName: "Maria Silva",
  counterpartyIban: TENANT_IBAN,
  reference: "renda 06/2026",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  logAuditMock.mockResolvedValue(undefined);
  allocateReceiptMock.mockResolvedValue(null);
});

describe("importBankRows — re-importing the same statement", () => {
  it("counts the second import as a duplicate and imports nothing", async () => {
    const first = await importBankRows(USER_ID, [rentRow]);
    const second = await importBankRows(USER_ID, [rentRow]);

    expect(first).toMatchObject({ imported: 1, duplicates: 0 });
    expect(second).toMatchObject({ imported: 0, duplicates: 1 });
  });

  it("never creates a second BankTransaction for a row it has already seen", async () => {
    await importBankRows(USER_ID, [rentRow]);
    await importBankRows(USER_ID, [rentRow]);

    expect(prismaMock.bankTransaction.create).toHaveBeenCalledTimes(1);
    expect(store.txns.size).toBe(1);
  });

  it("does not run the allocation waterfall a second time", async () => {
    // THE assertion this file exists for. Everything above is bookkeeping; this is the one that
    // says a re-uploaded statement cannot credit a tenant's rent twice. `allocateReceipt` is
    // reached only via createReceiptAndAllocate, which the `continue` skips entirely.
    const first = await importBankRows(USER_ID, [rentRow]);

    // Load-bearing precondition. If the fixture stopped auto-matching, every assertion below
    // would compare 0 against 0 and pass no matter what the dedupe guard did — inert green,
    // which is worse than no test. This line fails loudly if the fixture drifts.
    expect(first.autoMatched).toBe(1);
    expect(allocateReceiptMock).toHaveBeenCalledTimes(1);

    await importBankRows(USER_ID, [rentRow]);

    expect(allocateReceiptMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.receipt.create).toHaveBeenCalledTimes(1);
  });
});

/**
 * The allocation boundary a test connection may not cross.
 *
 * A connection made from /admin to prove the chain works runs the identical pipeline — same
 * fingerprint dedupe, same reconciliation rules, same confidence scoring — because a test that
 * took a different path would prove nothing about the path that matters. The one thing it must
 * not do is auto-create a `Receipt` and allocate it against a REAL lease out of sandbox money.
 *
 * That is not a tidiness rule. Deleting the connection afterwards cascades to `BankAccount` and
 * `BankTransaction` but NOT to `Receipt` (schema.prisma: the receipt relation is SetNull on the
 * transaction side), so an allocated test row would strand a receipt and its `PaymentAllocation`
 * rows in the ledger with no movement behind them — money that cannot be traced and was never
 * real. The quarantine is what makes the delete safe.
 *
 * The fixture below is the same one that auto-matches in the suite above, so if the quarantine
 * were dropped these assertions would fail rather than pass vacuously.
 */
describe("importBankRows — a test connection never allocates", () => {
  beforeEach(() => {
    prismaMock.bankConnection.findUnique.mockResolvedValue({
      metadata: JSON.stringify({ reference: "abc", isTest: true }),
    });
  });

  it("imports the row but leaves it for review instead of creating a receipt", async () => {
    const summary = await importBankRows(USER_ID, [rentRow]);

    // It still imported — the point is to exercise the pipeline, not to skip it.
    expect(summary.imported).toBe(1);

    // And it did not cross the boundary.
    expect(summary.autoMatched).toBe(0);
    expect(prismaMock.receipt.create).not.toHaveBeenCalled();
    expect(allocateReceiptMock).not.toHaveBeenCalled();

    const written = prismaMock.bankTransaction.create.mock.calls[0][0].data;
    expect(written.status).toBe("needs_review");
  });

  it("still records the confidence it would have matched on", async () => {
    // The evidence is the deliverable: an operator needs to see that the chain scored this row
    // at auto-match confidence, which is precisely what proves the sync works. Suppressing the
    // score along with the allocation would throw away the result of the test.
    await importBankRows(USER_ID, [rentRow]);

    const written = prismaMock.bankTransaction.create.mock.calls[0][0].data;
    expect(written.suggestedLeaseId).toBe(LEASE_ID);
    expect(written.matchConfidence).toBeGreaterThanOrEqual(0.85);
    expect(JSON.parse(written.matchReasons as string).warnings).toContain(
      "test_connection_not_allocated",
    );
  });
});

describe("importBankRows — duplicates inside a single batch", () => {
  it("dedupes a row against one earlier in the same file", async () => {
    // A movement a provider returns twice in one page, or a copy-paste error. Row 2's findUnique has to
    // see what row 1's create just wrote — the guard cannot rely on a pre-loop snapshot.
    const summary = await importBankRows(USER_ID, [rentRow, rentRow]);

    expect(summary).toMatchObject({ imported: 1, duplicates: 1 });
    expect(prismaMock.bankTransaction.create).toHaveBeenCalledTimes(1);
  });
});

describe("importBankRows — what is NOT a duplicate", () => {
  it("treats a one-cent difference as a distinct movement", async () => {
    const summary = await importBankRows(USER_ID, [rentRow, { ...rentRow, amount: 1250.01 }]);

    // Two genuinely different transfers must both land. A coarser key — say date plus
    // counterparty — would swallow the second and quietly lose a payment.
    expect(summary).toMatchObject({ imported: 2, duplicates: 0 });
  });

  it("treats the same amount on a different day as a distinct movement", async () => {
    const summary = await importBankRows(USER_ID, [
      rentRow,
      { ...rentRow, bookingDate: "2026-07-01", reference: "renda 07/2026" },
    ]);

    expect(summary).toMatchObject({ imported: 2, duplicates: 0 });
  });
});

describe("importBankRows — the summary tells the truth about a re-import", () => {
  it("reports duplicates separately from imports in the sync job stats", async () => {
    await importBankRows(USER_ID, [rentRow]);
    prismaMock.bankSyncJob.update.mockClear();

    await importBankRows(USER_ID, [rentRow]);

    // A re-import that reported "1 imported" would look like it worked. The landlord needs the
    // no-op to be visible, because the alternative is them importing a third time.
    const [[call]] = prismaMock.bankSyncJob.update.mock.calls;
    expect(JSON.parse(call.data.stats)).toMatchObject({ imported: 0, duplicates: 1 });
    expect(call.data.status).toBe("completed");
  });
});
