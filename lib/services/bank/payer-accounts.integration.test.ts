import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * An account the owner confirmed is remembered for that tenant, and from then on the same amount as
 * the rent from it is matched on its own. Whether that holds is a question about rows and about the
 * real waterfall: whose accounts, which tenant's leases, what the next movement scores against them.
 * So it is asked of a real SQLite file, through the real import and the real confirmation, not of a
 * mock that would answer whatever the code assumed.
 *
 * The schema is pushed WITHOUT `--accept-data-loss`: a fresh file needs no such consent, and the flag
 * is the one thing a development environment may refuse to run.
 */
describe("remembered payer accounts — real Prisma client + real SQLite file", () => {
  let tempDir: string;
  let prisma: Awaited<ReturnType<typeof loadClient>>;
  let importBankRows: typeof import("./import").importBankRows;
  let applyTransactionAction: typeof import("./import").applyTransactionAction;
  let hashIban: typeof import("./import").hashIban;
  let accounts: typeof import("./payer-accounts");

  async function loadClient() {
    const { getPrismaClient, resetPrismaClientForTests } =
      await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    return getPrismaClient();
  }

  const RENT = 950;
  const IBAN = "PT50000201231234567890154";
  /** A name and a reference that say nothing: only the account and the amount can match. */
  const PAYER = "Unrelated Payer Lda";
  let counter = 0;

  /** One account of the owner's with a tenant and the lease they rent under. */
  async function world(tag: string, rent = RENT) {
    const stamp = `${tag}-${Date.now()}-${counter++}`;
    const user = await prisma.user.create({ data: { email: `payer-${stamp}@example.com` } });
    const property = await prisma.property.create({
      data: {
        userId: user.id,
        name: `Rua ${stamp}`,
        address: `Rua ${stamp}, Lisboa`,
        type: "apartment",
        rent,
        status: "occupied",
      },
    });
    const tenant = await prisma.tenant.create({
      data: {
        userId: user.id,
        name: `Tenant ${stamp}`,
        rent,
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
        monthlyRent: rent,
      },
    });
    return { user, property, tenant, lease };
  }

  type World = Awaited<ReturnType<typeof world>>;

  /** Another lease of the same tenant, on a property of its own. */
  async function addLease(
    w: World,
    name: string,
    rent: number,
    status: "active" | "expired" = "active",
  ) {
    const property = await prisma.property.create({
      data: {
        userId: w.user.id,
        name,
        address: `${name}, Lisboa`,
        type: "other",
        rent,
        status: "occupied",
      },
    });
    return prisma.lease.create({
      data: {
        userId: w.user.id,
        propertyId: property.id,
        tenantId: w.tenant.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        monthlyRent: rent,
        status,
      },
    });
  }

  let reference = 0;

  /** One movement through the real import, and the row it became. */
  async function pay(
    w: World,
    when: string,
    amount: number,
    options: {
      iban?: string;
      reference?: string;
      target?: { connectionId: string; bankAccountId: string };
    } = {},
  ) {
    const ref = options.reference ?? `transfer ${reference++}`;
    const summary = await importBankRows(
      w.user.id,
      [
        {
          bookingDate: when,
          amount,
          counterpartyName: PAYER,
          counterpartyIban: options.iban ?? IBAN,
          reference: ref,
        },
      ],
      "manual_entry",
      options.target,
    );
    const movement = await prisma.bankTransaction.findFirstOrThrow({
      where: { userId: w.user.id, reference: ref },
    });
    return { summary, movement };
  }

  const reasonsOf = (movement: { matchReasons: string | null }): string[] =>
    JSON.parse(movement.matchReasons ?? "{}").reasons ?? [];
  const warningsOf = (movement: { matchReasons: string | null }): string[] =>
    JSON.parse(movement.matchReasons ?? "{}").warnings ?? [];

  const ledgerOf = async (leaseIds: string[]) => ({
    allocated: (await prisma.rentPeriod.findMany({ where: { leaseId: { in: leaseIds } } })).reduce(
      (sum, period) => sum + period.allocatedAmount,
      0,
    ),
    receipts: await prisma.receipt.count({ where: { leaseId: { in: leaseIds } } }),
  });

  /** The owner confirms the first movement from an account: the one thing that teaches it. */
  async function teach(w: World, iban = IBAN, when = "2026-06-10") {
    const { movement } = await pay(w, when, RENT, { iban });
    expect(movement.status, "the first payment from an account waits for the owner").toBe(
      "needs_review",
    );
    const confirmed = await applyTransactionAction(w.user.id, movement.id, "confirm", w.lease.id);
    expect(confirmed.status).toBe("matched_confirmed");
    return { movement, confirmed };
  }

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "situs-payer-test-"));
    const dbUrl = `file:${path.join(tempDir, "test.db")}`;

    execSync(`npx prisma db push --url="${dbUrl}"`, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = dbUrl;
    process.env.PII_ENCRYPTION_KEY = "e".repeat(64);
    prisma = await loadClient();
    ({ importBankRows, applyTransactionAction, hashIban } = await import("./import"));
    accounts = await import("./payer-accounts");
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    const { resetPrismaClientForTests } = await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it("remembers the account when the owner confirms its first payment, and keeps no IBAN", async () => {
    const w = await world("learn");

    const { movement, confirmed } = await teach(w);

    expect(confirmed.remembered).toBe(true);
    const rows = await prisma.payerAccount.findMany({ where: { tenantId: w.tenant.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: w.user.id,
      ibanHash: hashIban(IBAN),
      ibanLast4: "0154",
      holderName: PAYER,
      sourceTransactionId: movement.id,
    });
    // The hash is what matching reads. The account's number is stored nowhere in this row.
    expect(JSON.stringify(rows[0])).not.toContain(IBAN);

    const audit = await prisma.auditLog.findMany({
      where: { userId: w.user.id, action: "REMEMBER_PAYER_ACCOUNT" },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain(IBAN);
    expect(JSON.stringify(audit[0])).not.toContain(hashIban(IBAN));
  });

  it("allocates exactly the rent from that account on its own, and says why", async () => {
    const w = await world("exact");
    await teach(w);
    const before = await ledgerOf([w.lease.id]);

    const { summary, movement } = await pay(w, "2026-07-10", RENT);

    expect(summary).toMatchObject({ imported: 1, autoMatched: 1, needsReview: 0 });
    expect(movement).toMatchObject({ status: "auto_matched", suggestedLeaseId: w.lease.id });
    expect(movement.matchConfidence).toBe(0.85);
    expect(reasonsOf(movement)).toEqual(["learned_account", "amount_exact"]);
    expect(movement.receiptId).toBeTruthy();
    const after = await ledgerOf([w.lease.id]);
    expect(after.receipts).toBe(before.receipts + 1);
    expect(after.allocated).toBeCloseTo(before.allocated + RENT, 2);
  });

  it("learns each account once: confirming it again teaches nothing new", async () => {
    const w = await world("once");
    await teach(w);
    const { movement } = await pay(w, "2026-07-10", RENT * 2);

    const again = await applyTransactionAction(w.user.id, movement.id, "confirm", w.lease.id);

    expect(again.status).toBe("matched_confirmed");
    expect(again.remembered).toBeUndefined();
    expect(await prisma.payerAccount.count({ where: { tenantId: w.tenant.id } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { userId: w.user.id, action: "REMEMBER_PAYER_ACCOUNT" },
      }),
    ).toBe(1);
  });

  it("waits for the owner on any other amount from that account", async () => {
    const w = await world("amounts");
    await teach(w);
    const before = await ledgerOf([w.lease.id]);

    for (const [index, amount] of [RENT / 2, RENT * 2, RENT * 3, RENT + 20].entries()) {
      const { summary, movement } = await pay(w, `2026-07-${10 + index * 4}`, amount);

      expect(summary.autoMatched, `${amount} was matched on its own`).toBe(0);
      expect(movement.status).toBe("needs_review");
      expect(movement.receiptId).toBeNull();
      expect(reasonsOf(movement)).not.toContain("learned_account");
    }
    expect(await ledgerOf([w.lease.id])).toEqual(before);
  });

  it("does not trust an account nobody confirmed, not even at the exact rent", async () => {
    const w = await world("stranger");
    await teach(w);
    const before = await ledgerOf([w.lease.id]);

    const { summary, movement } = await pay(w, "2026-07-10", RENT, {
      iban: "PT50000201239999999999999",
    });

    expect(summary.autoMatched).toBe(0);
    expect(movement.status).toBe("needs_review");
    expect(await ledgerOf([w.lease.id])).toEqual(before);
  });

  it("is one account's own: another account of the instance gets nothing from it", async () => {
    const mine = await world("mine");
    const theirs = await world("theirs");
    await teach(mine);

    const { summary, movement } = await pay(theirs, "2026-07-10", RENT);

    expect(summary.autoMatched).toBe(0);
    expect(movement.status).toBe("needs_review");
    expect(await accounts.learnedHashesByTenant(theirs.user.id)).toEqual(new Map());
    expect(await accounts.payerAccountsFor(theirs.user.id, mine.tenant.id)).toEqual([]);
    await expect(
      accounts.forgetPayerAccount(
        theirs.user.id,
        mine.tenant.id,
        (await prisma.payerAccount.findFirstOrThrow({ where: { tenantId: mine.tenant.id } })).id,
      ),
    ).rejects.toMatchObject({ name: "ResourceNotFoundError" });
    expect(await prisma.payerAccount.count({ where: { tenantId: mine.tenant.id } })).toBe(1);
  });

  it("still waits when a reference names another month, or the movement looks like one just seen", async () => {
    const w = await world("holds");
    await teach(w);

    // The oldest month still open is not December.
    const wrongMonth = await pay(w, "2026-07-10", RENT, { reference: "renda 12/2026" });
    expect(wrongMonth.movement.status).toBe("needs_review");
    expect(warningsOf(wrongMonth.movement)).toEqual([
      expect.stringMatching(/^reference_conflict:2026-12/),
    ]);

    const first = await pay(w, "2026-08-10", RENT);
    expect(first.movement.status).toBe("auto_matched");
    // The same account, the same amount, a day later: it may be the same money seen twice.
    const again = await pay(w, "2026-08-11", RENT);
    expect(again.movement.status).toBe("needs_review");
    expect(warningsOf(again.movement)).toContain("possible_duplicate");
  });

  it("tells a tenant's two contracts apart by their rent, and waits when the rent cannot", async () => {
    const w = await world("two");
    const garage = await addLease(w, "Garagem A", 95);
    await teach(w);

    const flat = await pay(w, "2026-07-10", RENT);
    const box = await pay(w, "2026-07-20", 95);

    expect(flat.movement.status).toBe("auto_matched");
    expect(flat.movement.suggestedLeaseId).toBe(w.lease.id);
    expect(box.movement.status).toBe("auto_matched");
    expect(box.movement.suggestedLeaseId).toBe(garage.id);
    expect((await ledgerOf([garage.id])).allocated).toBeCloseTo(95, 2);

    // Two contracts at the one rent are too close to call, and the owner decides.
    await addLease(w, "Garagem B", RENT);
    const twin = await pay(w, "2026-08-10", RENT);
    expect(twin.summary.autoMatched).toBe(0);
    expect(twin.movement.status).toBe("needs_review");
    expect(JSON.parse(twin.movement.matchReasons ?? "{}").warnings).toContain(
      "ambiguous_candidates",
    );
  });

  it("is the tenant's, so a new contract inherits it", async () => {
    const w = await world("renewal");
    await teach(w);
    await prisma.lease.update({ where: { id: w.lease.id }, data: { status: "expired" } });
    const renewed = await addLease(w, "Rua Renovada", RENT);

    const { summary, movement } = await pay(w, "2026-07-10", RENT);

    expect(summary.autoMatched).toBe(1);
    expect(movement.suggestedLeaseId).toBe(renewed.id);
    expect(
      (await prisma.receipt.findUniqueOrThrow({ where: { id: movement.receiptId! } })).leaseId,
    ).toBe(renewed.id);
  });

  it("is taught by assigning a movement to another contract, and by linking one to a recorded payment", async () => {
    const assigned = await world("assign");
    const garage = await addLease(assigned, "Garagem C", 95);
    const { movement } = await pay(assigned, "2026-06-10", 95);

    const result = await applyTransactionAction(
      assigned.user.id,
      movement.id,
      "reassign",
      garage.id,
    );

    expect(result.remembered).toBe(true);
    expect(await prisma.payerAccount.count({ where: { tenantId: assigned.tenant.id } })).toBe(1);

    const linked = await world("link");
    await prisma.receipt.create({
      data: {
        userId: linked.user.id,
        tenantId: linked.tenant.id,
        propertyId: linked.property.id,
        leaseId: linked.lease.id,
        amount: RENT,
        date: new Date("2026-06-04"),
        type: "rent",
        status: "paid",
        source: "manual",
      },
    });
    const period = await prisma.rentPeriod.create({
      data: {
        userId: linked.user.id,
        leaseId: linked.lease.id,
        tenantId: linked.tenant.id,
        propertyId: linked.property.id,
        year: 2026,
        month: 6,
        dueDate: new Date("2026-06-01"),
        dueAmount: RENT,
        allocatedAmount: RENT,
      },
    });
    const recorded = await prisma.receipt.findFirstOrThrow({ where: { leaseId: linked.lease.id } });
    await prisma.paymentAllocation.create({
      data: {
        userId: linked.user.id,
        rentPeriodId: period.id,
        receiptId: recorded.id,
        amount: RENT,
      },
    });
    const waiting = await pay(linked, "2026-06-10", RENT);
    // The payer's name says nothing, but the lease has to be suggested for the owner to link.
    await prisma.bankTransaction.update({
      where: { id: waiting.movement.id },
      data: { suggestedLeaseId: linked.lease.id },
    });

    const answer = await applyTransactionAction(
      linked.user.id,
      waiting.movement.id,
      "link",
      undefined,
      {
        receiptId: recorded.id,
      },
    );

    expect(answer).toMatchObject({ status: "matched_confirmed", remembered: true });
    expect(await prisma.payerAccount.count({ where: { tenantId: linked.tenant.id } })).toBe(1);
  });

  it("does not teach the tenant of a contract that a movement's receipt stays away from", async () => {
    const w = await world("kept-receipt");
    await teach(w);
    // The next payment matches on its own and its receipt lands on the first contract.
    const { summary, movement } = await pay(w, "2026-07-10", RENT);
    expect(summary.autoMatched).toBe(1);

    // A hand-made request names a contract of another tenant of the same owner.
    const lease = await prisma.lease.create({
      data: {
        userId: w.user.id,
        propertyId: (
          await prisma.property.create({
            data: {
              userId: w.user.id,
              name: `Elsewhere ${w.user.id}`,
              address: `Elsewhere ${w.user.id}, Lisboa`,
              type: "other",
              rent: RENT + 300,
              status: "occupied",
            },
          })
        ).id,
        tenantId: (
          await prisma.tenant.create({
            data: {
              userId: w.user.id,
              name: `Elsewhere ${w.user.id}`,
              rent: RENT + 300,
              leaseStart: new Date("2026-01-01"),
              leaseEnd: new Date("2026-12-31"),
            },
          })
        ).id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        monthlyRent: RENT + 300,
      },
    });

    const result = await applyTransactionAction(w.user.id, movement.id, "reassign", lease.id);

    expect(result).toEqual({ status: "matched_confirmed", receiptId: movement.receiptId });
    expect(await accounts.payerAccountsFor(w.user.id, lease.tenantId)).toEqual([]);
    expect(await accounts.payerAccountsFor(w.user.id, w.tenant.id)).toHaveLength(1);
    expect(
      (await prisma.receipt.findFirstOrThrow({ where: { id: movement.receiptId! } })).leaseId,
    ).toBe(w.lease.id);
  });

  it("is not taught by a movement the owner did not confirm, nor by one that matched on its own", async () => {
    const w = await world("untaught");
    await teach(w);
    const before = await prisma.payerAccount.count({ where: { tenantId: w.tenant.id } });

    // Matched on its own by the account the owner already vouched for: a guess, teaching nothing.
    const auto = await pay(w, "2026-07-10", RENT);
    expect(auto.movement.status).toBe("auto_matched");
    // Ignored by the owner.
    const ignored = await pay(w, "2026-07-20", RENT * 2, { iban: "PT50000201238888888888888" });
    await applyTransactionAction(w.user.id, ignored.movement.id, "ignore");

    expect(await prisma.payerAccount.count({ where: { tenantId: w.tenant.id } })).toBe(before);
    expect(
      await prisma.payerAccount.count({
        where: { ibanHash: hashIban("PT50000201238888888888888") },
      }),
    ).toBe(0);
  });

  it("is never taught by sandbox money from a test connection", async () => {
    const w = await world("sandbox");
    const connection = await prisma.bankConnection.create({
      data: {
        userId: w.user.id,
        institutionName: "Mock ASPSP",
        metadata: JSON.stringify({ isTest: true }),
      },
    });
    const account = await prisma.bankAccount.create({
      data: { connectionId: connection.id, userId: w.user.id, label: "Conta de teste" },
    });

    const { movement } = await pay(w, "2026-06-10", RENT, {
      target: { connectionId: connection.id, bankAccountId: account.id },
    });
    const result = await applyTransactionAction(w.user.id, movement.id, "confirm", w.lease.id);

    expect(result.status).toBe("matched_confirmed");
    expect(result.remembered).toBeUndefined();
    expect(await prisma.payerAccount.count({ where: { tenantId: w.tenant.id } })).toBe(0);
  });

  it("goes back to asking when the owner forgets the account, and says so in the audit trail", async () => {
    const w = await world("forget");
    await teach(w);
    const [account] = await accounts.payerAccountsFor(w.user.id, w.tenant.id);
    expect(account).toMatchObject({ ibanLast4: "0154", holderName: PAYER });

    await accounts.forgetPayerAccount(w.user.id, w.tenant.id, account.id);

    expect(await accounts.payerAccountsFor(w.user.id, w.tenant.id)).toEqual([]);
    const audit = await prisma.auditLog.findMany({
      where: { userId: w.user.id, action: "FORGET_PAYER_ACCOUNT" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].resourceId).toBe(account.id);

    const before = await ledgerOf([w.lease.id]);
    const { summary, movement } = await pay(w, "2026-07-10", RENT);
    expect(summary.autoMatched).toBe(0);
    expect(movement.status).toBe("needs_review");
    expect(await ledgerOf([w.lease.id])).toEqual(before);

    // Forgetting it twice is a 404, and nothing else changes.
    await expect(
      accounts.forgetPayerAccount(w.user.id, w.tenant.id, account.id),
    ).rejects.toMatchObject({ name: "ResourceNotFoundError" });
  });

  it("is learned again by the next confirmation, since the owner said so again", async () => {
    const w = await world("relearn");
    await teach(w);
    const [account] = await accounts.payerAccountsFor(w.user.id, w.tenant.id);
    await accounts.forgetPayerAccount(w.user.id, w.tenant.id, account.id);

    const { movement } = await pay(w, "2026-07-10", RENT);
    const again = await applyTransactionAction(w.user.id, movement.id, "confirm", w.lease.id);

    expect(again.remembered).toBe(true);
    expect(await accounts.payerAccountsFor(w.user.id, w.tenant.id)).toHaveLength(1);
  });

  it("belongs to the tenant: removing the tenant removes what was remembered for them", async () => {
    const w = await world("cascade");
    await teach(w);
    expect(await prisma.payerAccount.count({ where: { userId: w.user.id } })).toBe(1);

    await prisma.tenant.delete({ where: { id: w.tenant.id } });

    expect(await prisma.payerAccount.count({ where: { userId: w.user.id } })).toBe(0);
  });

  it("answers that an account it already has is not new, and keeps one row", async () => {
    const w = await world("direct");
    const { movement } = await teach(w);
    const stored = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: movement.id } });

    expect(await accounts.rememberPayerAccount(w.user.id, w.tenant.id, stored)).toBe(false);
    expect(await prisma.payerAccount.count({ where: { tenantId: w.tenant.id } })).toBe(1);
  });

  it("has nothing to remember from a movement with no account", async () => {
    const w = await world("noaccount");
    const stored = await prisma.bankTransaction.create({
      data: {
        userId: w.user.id,
        bankAccountId: (
          await prisma.bankAccount.create({
            data: {
              userId: w.user.id,
              label: "Conta sem IBAN",
              connectionId: (
                await prisma.bankConnection.create({
                  data: { userId: w.user.id, institutionName: "Banco Sem IBAN" },
                })
              ).id,
            },
          })
        ).id,
        fingerprint: `no-iban-${w.user.id}`,
        amount: RENT,
        bookingDate: new Date("2026-06-10"),
      },
    });

    expect(await accounts.rememberPayerAccount(w.user.id, w.tenant.id, stored)).toBe(false);
    expect(await prisma.payerAccount.count({ where: { tenantId: w.tenant.id } })).toBe(0);
  });

  it("keeps what is remembered for one tenant apart from another tenant of the same owner", async () => {
    const w = await world("two-tenants");
    await teach(w);
    const [account] = await accounts.payerAccountsFor(w.user.id, w.tenant.id);
    const other = await prisma.tenant.create({
      data: {
        userId: w.user.id,
        name: `Other ${w.user.id}`,
        rent: RENT,
        leaseStart: new Date("2026-01-01"),
        leaseEnd: new Date("2026-12-31"),
      },
    });

    expect(await accounts.payerAccountsFor(w.user.id, other.id)).toEqual([]);
    expect((await accounts.learnedHashesByTenant(w.user.id)).get(other.id)).toBeUndefined();
    await expect(
      accounts.forgetPayerAccount(w.user.id, other.id, account.id),
    ).rejects.toMatchObject({ name: "ResourceNotFoundError" });
    expect(await accounts.payerAccountsFor(w.user.id, w.tenant.id)).toHaveLength(1);
  });

  it("keeps no digits for an IBAN it cannot read, not the placeholder's", async () => {
    const w = await world("unreadable");
    const { movement } = await pay(w, "2026-06-10", RENT);
    const stored = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: movement.id } });

    // In the encrypted form but damaged, as after a key rotation: it reads as the placeholder.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const taught = await accounts.rememberPayerAccount(w.user.id, w.tenant.id, {
      ...stored,
      counterpartyIban: "enc:damaged",
    });
    warn.mockRestore();

    expect(taught).toBe(true);
    expect(await accounts.payerAccountsFor(w.user.id, w.tenant.id)).toEqual([
      expect.objectContaining({ ibanLast4: null, holderName: PAYER }),
    ]);
  });

  it("never writes for a tenant that is not the caller's", async () => {
    const mine = await world("guard-mine");
    const theirs = await world("guard-theirs");
    const { movement } = await pay(mine, "2026-06-10", RENT);

    const stored = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: movement.id } });
    const taught = await accounts.rememberPayerAccount(mine.user.id, theirs.tenant.id, stored);

    expect(taught).toBe(false);
    expect(await prisma.payerAccount.count({ where: { tenantId: theirs.tenant.id } })).toBe(0);
  });
});
