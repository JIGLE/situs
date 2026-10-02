import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Which payments the owner recorded a bank movement may be the same money as. What counts as one
 * is a question about rows (whose, which lease, paid, still counting on the ledger, with no
 * movement linked yet), so it is asked of a real SQLite file: a mock would hold whatever the query
 * said it filtered.
 *
 * The schema is pushed WITHOUT `--accept-data-loss`: a fresh file needs no such consent, and the
 * flag is the one thing a development environment may refuse to run.
 */
describe("recorded payments — real Prisma client + real SQLite file", () => {
  let tempDir: string;
  let prisma: Awaited<ReturnType<typeof loadClient>>;
  let recordedPaymentsFor: typeof import("./recorded-payments").recordedPaymentsFor;
  let recordedPaymentsForMovements: typeof import("./recorded-payments").recordedPaymentsForMovements;

  async function loadClient() {
    const { getPrismaClient, resetPrismaClientForTests } =
      await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    return getPrismaClient();
  }

  const RENT = 950;
  let counter = 0;

  /** One account with one lease, and what is needed to record payments on it. */
  async function world(tag: string) {
    const stamp = `${tag}-${Date.now()}-${counter++}`;
    const user = await prisma.user.create({ data: { email: `recorded-${stamp}@example.com` } });
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
    return { user, property, tenant, lease, periods: 0 };
  }

  type World = Awaited<ReturnType<typeof world>>;

  /** A payment recorded by hand: a paid rent receipt, with its live allocation on a rent month. */
  async function record(
    w: World,
    when: string,
    overrides: {
      amount?: number;
      type?: "rent" | "deposit";
      status?: "paid" | "pending";
      lifecycle?: string;
      allocation?: "live" | "reversed" | "none";
      leaseId?: string;
    } = {},
  ) {
    const amount = overrides.amount ?? RENT;
    const leaseId = overrides.leaseId ?? w.lease.id;
    const receipt = await prisma.receipt.create({
      data: {
        userId: w.user.id,
        tenantId: w.tenant.id,
        propertyId: w.property.id,
        leaseId,
        amount,
        date: new Date(when),
        type: overrides.type ?? "rent",
        status: overrides.status ?? "paid",
        ...(overrides.lifecycle ? { lifecycle: overrides.lifecycle } : {}),
        source: "manual",
      },
    });
    const allocation = overrides.allocation ?? "live";
    if (allocation !== "none") {
      w.periods += 1;
      const period = await prisma.rentPeriod.create({
        data: {
          userId: w.user.id,
          leaseId,
          tenantId: w.tenant.id,
          propertyId: w.property.id,
          year: 2026,
          month: w.periods,
          dueDate: new Date(Date.UTC(2026, w.periods - 1, 1)),
          dueAmount: amount,
          allocatedAmount: amount,
        },
      });
      await prisma.paymentAllocation.create({
        data: {
          userId: w.user.id,
          rentPeriodId: period.id,
          receiptId: receipt.id,
          amount,
          ...(allocation === "reversed" ? { reversedAt: new Date() } : {}),
        },
      });
    }
    return receipt;
  }

  /** A bank movement already linked to a receipt. */
  async function linkMovement(w: World, receiptId: string) {
    const connection = await prisma.bankConnection.create({
      data: { userId: w.user.id, institutionName: "Banco Teste" },
    });
    const account = await prisma.bankAccount.create({
      data: { connectionId: connection.id, userId: w.user.id, label: "Conta" },
    });
    return prisma.bankTransaction.create({
      data: {
        userId: w.user.id,
        bankAccountId: account.id,
        fingerprint: `fp-${receiptId}`,
        amount: RENT,
        bookingDate: new Date("2026-06-10"),
        receiptId,
        status: "matched_confirmed",
      },
    });
  }

  const movement = (bookingDate: string, amount = RENT) => ({
    amount,
    bookingDate: new Date(bookingDate),
  });
  const ids = (list: { id: string }[]) => list.map((payment) => payment.id);

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "situs-recorded-test-"));
    const dbUrl = `file:${path.join(tempDir, "test.db")}`;

    execSync(`npx prisma db push --url="${dbUrl}"`, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = dbUrl;
    process.env.PII_ENCRYPTION_KEY = "d".repeat(64);
    prisma = await loadClient();
    ({ recordedPaymentsFor, recordedPaymentsForMovements } = await import("./recorded-payments"));
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    const { resetPrismaClientForTests } = await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds the payment recorded by hand for the same amount around the booking date", async () => {
    const w = await world("found");
    const receipt = await record(w, "2026-06-04");

    const found = await recordedPaymentsFor(w.user.id, w.lease.id, movement("2026-06-10"));

    expect(ids(found)).toEqual([receipt.id]);
    expect(found[0]).toMatchObject({ amount: RENT });
  });

  it("looks only at the amount to the cent, and the days around the booking", async () => {
    const w = await world("figures");
    await record(w, "2026-06-04", { amount: RENT + 0.01 });
    await record(w, "2026-05-30"); // 11 days before the booking
    await record(w, "2026-06-21"); // 11 days after

    expect(await recordedPaymentsFor(w.user.id, w.lease.id, movement("2026-06-10"))).toEqual([]);

    const edge = await record(w, "2026-05-31"); // 10 days before: still the same payment
    expect(ids(await recordedPaymentsFor(w.user.id, w.lease.id, movement("2026-06-10")))).toEqual([
      edge.id,
    ]);
  });

  it("is scoped to the account and to the lease", async () => {
    const mine = await world("mine");
    const theirs = await world("theirs");
    await record(theirs, "2026-06-04");

    // Another account's payment of the very same amount and date is not mine to link.
    expect(await recordedPaymentsFor(mine.user.id, mine.lease.id, movement("2026-06-10"))).toEqual(
      [],
    );
    // Nor is it found by naming their lease.
    expect(
      await recordedPaymentsFor(mine.user.id, theirs.lease.id, movement("2026-06-10")),
    ).toEqual([]);

    // And a payment on another lease of my own stays on that lease.
    const otherLease = await prisma.lease.create({
      data: {
        userId: mine.user.id,
        propertyId: mine.property.id,
        tenantId: mine.tenant.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        monthlyRent: RENT,
      },
    });
    const onOther = await record(mine, "2026-06-04", { leaseId: otherLease.id });
    expect(await recordedPaymentsFor(mine.user.id, mine.lease.id, movement("2026-06-10"))).toEqual(
      [],
    );
    expect(
      ids(await recordedPaymentsFor(mine.user.id, otherLease.id, movement("2026-06-10"))),
    ).toEqual([onOther.id]);
  });

  it("leaves out a payment a movement is already linked to", async () => {
    const w = await world("linked");
    const taken = await record(w, "2026-06-04");
    const free = await record(w, "2026-06-06");
    await linkMovement(w, taken.id);

    expect(ids(await recordedPaymentsFor(w.user.id, w.lease.id, movement("2026-06-10")))).toEqual([
      free.id,
    ]);
  });

  it("leaves out what does not count: voided, unpaid, not rent, or no longer allocated", async () => {
    const w = await world("not-counting");
    await record(w, "2026-06-04", { lifecycle: "voided" });
    await record(w, "2026-06-04", { status: "pending" });
    await record(w, "2026-06-04", { type: "deposit" });
    await record(w, "2026-06-04", { allocation: "reversed" });
    await record(w, "2026-06-04", { allocation: "none" });
    const counts = await record(w, "2026-06-04");

    expect(ids(await recordedPaymentsFor(w.user.id, w.lease.id, movement("2026-06-10")))).toEqual([
      counts.id,
    ]);
  });

  it("answers for several movements in one go, each against its own lease", async () => {
    const w = await world("many");
    const second = await prisma.lease.create({
      data: {
        userId: w.user.id,
        propertyId: w.property.id,
        tenantId: w.tenant.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        monthlyRent: 700,
      },
    });
    const june = await record(w, "2026-06-04");
    const august = await record(w, "2026-08-03");
    const other = await record(w, "2026-06-05", { amount: 700, leaseId: second.id });

    const found = await recordedPaymentsForMovements(w.user.id, [
      { id: "m-june", suggestedLeaseId: w.lease.id, ...movement("2026-06-10") },
      { id: "m-august", suggestedLeaseId: w.lease.id, ...movement("2026-08-05") },
      { id: "m-other-lease", suggestedLeaseId: second.id, ...movement("2026-06-10", 700) },
      // Nothing to check against: no lease suggested, money going out.
      { id: "m-no-lease", suggestedLeaseId: null, ...movement("2026-06-10") },
      { id: "m-out", suggestedLeaseId: w.lease.id, ...movement("2026-06-10", -RENT) },
      // The right lease, nothing recorded near the date.
      { id: "m-nothing", suggestedLeaseId: w.lease.id, ...movement("2026-10-10") },
    ]);

    expect([...found.keys()].sort()).toEqual(["m-august", "m-june", "m-other-lease"]);
    expect(ids(found.get("m-june")!)).toEqual([june.id]);
    expect(ids(found.get("m-august")!)).toEqual([august.id]);
    expect(ids(found.get("m-other-lease")!)).toEqual([other.id]);
  });

  it("asks nothing of the database when there is nothing to check", async () => {
    const w = await world("empty");
    expect((await recordedPaymentsForMovements(w.user.id, [])).size).toBe(0);
    expect(
      (
        await recordedPaymentsForMovements(w.user.id, [
          { id: "m", suggestedLeaseId: null, ...movement("2026-06-10") },
        ])
      ).size,
    ).toBe(0);
  });
});
