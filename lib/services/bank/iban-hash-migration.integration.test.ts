import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * IBAN hashes stored before they were keyed are converted without the IBAN, and nothing that
 * recognised an account, a movement or a rule before stops doing so.
 *
 * Asked of a real SQLite file and the real import, because what matters is what the next movement
 * does after the conversion: a remembered payer account must still be recognised, a movement
 * already imported must still be a duplicate when its statement is fetched again (its fingerprint
 * holds the IBAN hash), and a rule on a hash must still fire. A mock would answer whatever the code
 * assumed.
 *
 * Old data is made by importing with no PII key set, which is how hashes were made before: plain.
 */
describe("IBAN hash migration — real Prisma client + real SQLite file", () => {
  let tempDir: string;
  let prisma: Awaited<ReturnType<typeof loadClient>>;
  let imp: typeof import("./import");
  let mig: typeof import("./iban-hash-migration");
  let hashing: typeof import("@/lib/utils/iban-hash");

  async function loadClient() {
    const { getPrismaClient, resetPrismaClientForTests } =
      await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    return getPrismaClient();
  }

  const KEY = "d".repeat(64);
  const RENT = 950;
  const IBAN = "PT50000201231234567890154";
  const PAYER = "Unrelated Payer Lda";
  let counter = 0;

  const withoutKey = () => {
    process.env.PII_ENCRYPTION_KEY = "";
  };
  const withKey = () => {
    process.env.PII_ENCRYPTION_KEY = KEY;
  };

  async function world(tag: string) {
    const stamp = `${tag}-${Date.now()}-${counter++}`;
    const user = await prisma.user.create({ data: { email: `ibanhash-${stamp}@example.com` } });
    const property = await prisma.property.create({
      data: {
        userId: user.id,
        name: `Rua ${stamp}`,
        address: `Rua ${stamp}, Lisboa`,
        type: "apartment",
        rent: RENT,
        status: "occupied",
      },
    });
    const tenant = await prisma.tenant.create({
      data: {
        userId: user.id,
        name: `Tenant ${stamp}`,
        rent: RENT,
        leaseStart: new Date("2026-01-01"),
        leaseEnd: new Date("2026-12-31"),
      },
    });
    const lease = await prisma.lease.create({
      data: {
        userId: user.id,
        propertyId: property.id,
        tenantId: tenant.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        monthlyRent: RENT,
      },
    });
    return { user, tenant, lease };
  }
  type World = Awaited<ReturnType<typeof world>>;

  let reference = 0;
  async function pay(w: World, when: string, amount = RENT, iban = IBAN) {
    const ref = `transfer ${reference++}`;
    const row = {
      bookingDate: when,
      amount,
      counterpartyName: PAYER,
      counterpartyIban: iban,
      reference: ref,
    };
    const summary = await imp.importBankRows(w.user.id, [row], "manual_entry");
    const movement = await prisma.bankTransaction.findFirstOrThrow({
      where: { userId: w.user.id, reference: ref },
    });
    return { summary, movement, row };
  }

  const reasonsOf = (m: { matchReasons: string | null }): string[] =>
    JSON.parse(m.matchReasons ?? "{}").reasons ?? [];

  /** A bank account with a plain hash, as one made before hashes were keyed. */
  async function plainAccount(w: World, iban = IBAN) {
    const connection = await prisma.bankConnection.create({
      data: { userId: w.user.id, institutionName: "Old Bank" },
    });
    return prisma.bankAccount.create({
      data: {
        connectionId: connection.id,
        userId: w.user.id,
        label: "Conta antiga",
        ibanHash: hashing.plainIbanHash(iban),
      },
    });
  }

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "situs-ibanhash-test-"));
    const dbUrl = `file:${path.join(tempDir, "test.db")}`;
    execSync(`npx prisma db push --url="${dbUrl}"`, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });
    process.env.DATABASE_URL = dbUrl;
    withoutKey();
    prisma = await loadClient();
    imp = await import("./import");
    mig = await import("./iban-hash-migration");
    hashing = await import("@/lib/utils/iban-hash");
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    const { resetPrismaClientForTests } = await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it("converts the account, the movement and its fingerprint, the payer account and the rule", async () => {
    withoutKey();
    const w = await world("all");
    const account = await plainAccount(w);
    const { movement } = await pay(w, "2026-06-10");
    const payer = await prisma.payerAccount.create({
      data: {
        userId: w.user.id,
        tenantId: w.tenant.id,
        ibanHash: hashing.plainIbanHash(IBAN),
        ibanLast4: "0154",
      },
    });
    const rule = await prisma.reconciliationRule.create({
      data: {
        userId: w.user.id,
        name: "Known payer",
        condition: JSON.stringify({
          field: "iban_hash",
          op: "equals",
          value: hashing.plainIbanHash(IBAN),
        }),
        action: JSON.stringify({ type: "ignore" }),
      },
    });
    expect(movement.counterpartyIbanHash, "old data is plain").toBe(hashing.plainIbanHash(IBAN));

    withKey();
    const result = await mig.migrateIbanHashes();

    const keyed = hashing.hashIban(IBAN);
    expect(keyed.startsWith("v2:")).toBe(true);
    expect(result.accounts).toBeGreaterThanOrEqual(1);
    expect(
      (await prisma.bankAccount.findUniqueOrThrow({ where: { id: account.id } })).ibanHash,
    ).toBe(keyed);
    const converted = await prisma.bankTransaction.findUniqueOrThrow({
      where: { id: movement.id },
    });
    expect(converted.counterpartyIbanHash).toBe(keyed);
    // The fingerprint was rebuilt from the row's own fields around the new hash.
    expect(converted.fingerprint).toBe(
      imp.computeFingerprint({
        bankAccountId: converted.bankAccountId,
        amount: converted.amount,
        bookingDate: "2026-06-10",
        counterpartyIbanHash: keyed,
        counterpartyName: converted.counterpartyName,
        reference: converted.reference,
      }),
    );
    expect(converted.fingerprint).not.toBe(movement.fingerprint);
    expect(
      (await prisma.payerAccount.findUniqueOrThrow({ where: { id: payer.id } })).ibanHash,
    ).toBe(keyed);
    const converted2 = await prisma.reconciliationRule.findUniqueOrThrow({
      where: { id: rule.id },
    });
    expect(JSON.parse(converted2.condition)).toEqual({
      field: "iban_hash",
      op: "equals",
      value: keyed,
    });
    expect(JSON.parse(converted2.action)).toEqual({ type: "ignore" });
  });

  it("leaves no plain hash behind, and a second run converts nothing", async () => {
    withoutKey();
    const w = await world("twice");
    await plainAccount(w, "PT50000201231234567890155");
    await pay(w, "2026-06-11", RENT, "PT50000201231234567890155");
    withKey();

    const first = await mig.migrateIbanHashes();
    const second = await mig.migrateIbanHashes();

    expect(first.accounts + first.movements).toBeGreaterThan(0);
    expect(second).toEqual({
      accounts: 0,
      movements: 0,
      fingerprintsKept: 0,
      payerAccounts: 0,
      rules: 0,
    });
    expect(
      await prisma.bankAccount.count({
        where: { ibanHash: { not: null }, NOT: { ibanHash: { startsWith: "v2:" } } },
      }),
    ).toBe(0);
    expect(
      await prisma.bankTransaction.count({
        where: {
          counterpartyIbanHash: { not: null },
          NOT: { counterpartyIbanHash: { startsWith: "v2:" } },
        },
      }),
    ).toBe(0);
  });

  it("still recognises a movement fetched again: its fingerprint survives the conversion", async () => {
    withoutKey();
    const w = await world("dedupe");
    const { row } = await pay(w, "2026-06-12");
    withKey();
    await mig.migrateIbanHashes();

    const again = await imp.importBankRows(w.user.id, [row], "manual_entry");

    expect(again.duplicates).toBe(1);
    expect(again.imported).toBe(0);
    expect(await prisma.bankTransaction.count({ where: { userId: w.user.id } })).toBe(1);
  });

  it("still recognises an account the owner confirmed before the conversion", async () => {
    withoutKey();
    const w = await world("learned");
    const { movement } = await pay(w, "2026-06-10");
    await imp.applyTransactionAction(w.user.id, movement.id, "confirm", w.lease.id);
    const learned = await prisma.payerAccount.findMany({ where: { tenantId: w.tenant.id } });
    expect(learned, "the account was learned").toHaveLength(1);
    expect(learned[0].ibanHash).toBe(hashing.plainIbanHash(IBAN));

    withKey();
    await mig.migrateIbanHashes();
    const next = await pay(w, "2026-07-10");

    expect(reasonsOf(next.movement)).toContain("learned_account");
    expect(next.movement.status).toBe("auto_matched");
  });

  it("fires a reconciliation rule on a hash after the conversion", async () => {
    withoutKey();
    const w = await world("rule");
    await prisma.reconciliationRule.create({
      data: {
        userId: w.user.id,
        name: "Ignore this payer",
        condition: JSON.stringify({
          field: "iban_hash",
          op: "equals",
          value: hashing.plainIbanHash(IBAN),
        }),
        action: JSON.stringify({ type: "ignore" }),
      },
    });
    withKey();
    await mig.migrateIbanHashes();

    const { movement } = await pay(w, "2026-06-13");

    expect(movement.status).toBe("ignored");
  });

  it("keeps a fingerprint it cannot reproduce from the row, and still converts the hash", async () => {
    withoutKey();
    const w = await world("kept");
    const { movement } = await pay(w, "2026-06-14");
    await prisma.bankTransaction.update({
      where: { id: movement.id },
      data: { fingerprint: "made-by-something-else" },
    });
    withKey();

    const result = await mig.migrateIbanHashes();

    expect(result.fingerprintsKept).toBeGreaterThanOrEqual(1);
    const row = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: movement.id } });
    expect(row.fingerprint).toBe("made-by-something-else");
    expect(row.counterpartyIbanHash).toBe(hashing.hashIban(IBAN));
  });

  it("reaches a plain hash that sits behind more keyed ones than one batch holds", async () => {
    withKey();
    const w = await world("behind");
    const connection = await prisma.bankConnection.create({
      data: { userId: w.user.id, institutionName: "Many Accounts" },
    });
    // More keyed accounts than a batch, created first: a read that does not leave them out would be
    // filled by them and never see the plain one after.
    await prisma.bankAccount.createMany({
      data: Array.from({ length: 450 }, (_, i) => ({
        connectionId: connection.id,
        userId: w.user.id,
        label: `Conta ${i}`,
        ibanHash: hashing.hashIban(`PT50000201231234567${String(i).padStart(6, "0")}`),
      })),
    });
    withoutKey();
    const late = await prisma.bankAccount.create({
      data: {
        connectionId: connection.id,
        userId: w.user.id,
        label: "Conta tardia",
        ibanHash: hashing.plainIbanHash("PT50000201231234567999999"),
      },
    });
    withKey();

    await mig.migrateIbanHashes();

    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: late.id } })).ibanHash).toBe(
      hashing.hashIban("PT50000201231234567999999"),
    );
  }, 60_000);

  it("does nothing, and says why, with no key", async () => {
    withoutKey();
    const w = await world("nokey");
    const account = await plainAccount(w, "PT50000201231234567890156");

    const result = await mig.migrateIbanHashes();

    expect(result).toMatchObject({ skipped: "no_key", accounts: 0, movements: 0 });
    expect(
      (await prisma.bankAccount.findUniqueOrThrow({ where: { id: account.id } })).ibanHash,
    ).toBe(hashing.plainIbanHash("PT50000201231234567890156"));
  });

  it("leaves a movement with no IBAN, and another account's hash, alone", async () => {
    withKey();
    const w = await world("noiban");
    const row = {
      bookingDate: "2026-06-15",
      amount: 12,
      counterpartyName: "Cash",
      reference: `no iban ${reference++}`,
    };
    await imp.importBankRows(w.user.id, [row], "manual_entry");
    const before = await prisma.bankTransaction.findFirstOrThrow({ where: { userId: w.user.id } });

    await mig.migrateIbanHashes();

    const after = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.counterpartyIbanHash).toBeNull();
    expect(after.fingerprint).toBe(before.fingerprint);
  });
});
