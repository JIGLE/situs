/**
 * The four alert types the bell shows, asserted at the generator level.
 *
 * Three of them used to read the tenant payment stack (`Invoice`, `PaymentTransaction`)
 * and were rewired onto the rent ledger when that stack was cut. Nothing covered them
 * before — so the rewire could have produced a bell that still worked and silently
 * emitted one alert type out of four, which is exactly the shape of defect this repo
 * keeps finding.
 *
 * The fake below applies the `where` clause rather than ignoring it. A fake that returns
 * its fixtures regardless would pass against a generator querying the wrong status set,
 * or the wrong date field, and would have reported clean on every defect asserted here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendReminderEmailMock = vi.fn();
vi.mock("./reminder-email", () => ({
  sendReminderEmail: (...args: unknown[]) => sendReminderEmailMock(...args),
  resetReminderEmailCache: () => {},
}));

const getPrismaClientMock = vi.fn();
vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => getPrismaClientMock(),
}));

import { runNotificationAutomation } from "./notification-automation";

// ---------------------------------------------------------------------------------------
// A `where` matcher covering only the operators these generators actually use. Anything
// else throws, so a generator that starts filtering on something new fails loudly here
// instead of being silently unfiltered.
// ---------------------------------------------------------------------------------------
type Row = Record<string, unknown>;

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition instanceof Date) return (value as Date)?.getTime?.() === condition.getTime();
  if (typeof condition === "object") {
    for (const [op, operand] of Object.entries(condition as Row)) {
      switch (op) {
        case "gte":
          if (!((value as Date) >= (operand as Date))) return false;
          break;
        case "lte":
          if (!((value as Date) <= (operand as Date))) return false;
          break;
        case "lt":
          if (!((value as Date) < (operand as Date))) return false;
          break;
        case "notIn":
          if ((operand as unknown[]).includes(value)) return false;
          break;
        case "in":
          if (!(operand as unknown[]).includes(value)) return false;
          break;
        case "contains":
          if (!String(value ?? "").includes(String(operand))) return false;
          break;
        default:
          throw new Error(`fake prisma: unsupported operator "${op}"`);
      }
    }
    return true;
  }
  return value === condition;
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([field, cond]) => matchesCondition(row[field], cond));
}

interface Fixtures {
  rentPeriods?: Row[];
  leases?: Row[];
  allocations?: Row[];
  notifications?: Row[];
}

function makePrisma(f: Fixtures) {
  const created: Row[] = [];
  const existing = f.notifications ?? [];
  const table = (rows: Row[]) => ({
    findMany: vi.fn(async ({ where }: { where: Row }) => rows.filter((r) => matches(r, where))),
  });
  return {
    client: {
      rentPeriod: table(f.rentPeriods ?? []),
      lease: table(f.leases ?? []),
      paymentAllocation: table(f.allocations ?? []),
      notification: {
        findFirst: vi.fn(async ({ where }: { where: Row }) => {
          const pool = [...existing, ...created];
          return pool.find((n) => matches(n, where)) ?? null;
        }),
        create: vi.fn(async ({ data }: { data: Row }) => {
          created.push(data);
          return data;
        }),
      },
    },
    created,
  };
}

/**
 * Midnight, `n` days from now, in the runtime's own zone.
 *
 * Production stores `RentPeriod.dueDate` as UTC midnight on the 1st of the reference
 * month (`periodDueDate` in lib/services/allocation/engine.ts) while the generators
 * measure lateness against local midnight — the two coincide in the UTC containers this
 * deploys as. Anchoring fixtures to the same local midnight keeps the D+N arithmetic
 * exact in any zone, so this suite does not quietly pass or fail on the runner's TZ.
 */
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** A RentPeriod as the generators read it — denormalized tenant/property included. */
function period(over: Row = {}): Row {
  return {
    id: "period-1",
    userId: "user-1",
    dueDate: daysFromNow(5),
    dueAmount: 800,
    allocatedAmount: 0,
    status: "upcoming",
    tenant: { name: "Ana Silva" },
    property: { address: "Rua A 1", country: "PT" },
    ...over,
  };
}

function allocation(over: Row = {}): Row {
  return {
    id: "alloc-1",
    userId: "user-1",
    amount: 800,
    allocatedAt: daysFromNow(-4),
    reversedAt: null,
    rentPeriod: {
      tenant: { name: "Ana Silva" },
      property: { address: "Rua A 1", country: "PT" },
      rentReceiptFilings: [],
    },
    ...over,
  };
}

function run(f: Fixtures) {
  const { client, created } = makePrisma(f);
  getPrismaClientMock.mockReturnValue(client);
  return runNotificationAutomation().then((result) => ({ result, created, client }));
}

beforeEach(() => {
  sendReminderEmailMock.mockReset();
  getPrismaClientMock.mockReset();
});

describe("rent reminders (payment_due, D-5)", () => {
  it("fires against the rent ledger, keyed to the period", async () => {
    const { result, created } = await run({ rentPeriods: [period()] });

    expect(result.rentReminders).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      userId: "user-1",
      type: "payment_due",
      entityType: "RentPeriod",
      entityId: "period-1",
    });
    expect(created[0].message).toContain("Ana Silva");
    expect(created[0].message).toContain("Rua A 1");
  });

  it("quotes the outstanding balance, not the full rent, on a part-paid period", async () => {
    const { created } = await run({
      rentPeriods: [period({ allocatedAmount: 300, status: "partially_paid" })],
    });

    expect(created[0].message).toContain("€500.00");
    expect(created[0].message).not.toContain("€800.00");
  });

  it.each(["paid", "paid_late", "waived"])("never chases a %s period", async (status) => {
    const { result, created } = await run({ rentPeriods: [period({ status })] });

    expect(result.rentReminders).toBe(0);
    expect(created).toHaveLength(0);
  });

  it("stays silent when the period is unsettled but nothing is left on it", async () => {
    const { result } = await run({
      rentPeriods: [period({ allocatedAmount: 800, status: "due" })],
    });

    expect(result.rentReminders).toBe(0);
  });

  it("does not repeat a reminder already sent for the period", async () => {
    const { result } = await run({
      rentPeriods: [period()],
      notifications: [
        { userId: "user-1", type: "payment_due", entityType: "RentPeriod", entityId: "period-1" },
      ],
    });

    expect(result.rentReminders).toBe(0);
  });
});

describe("overdue notices (payment_overdue, D+1 and D+7)", () => {
  it.each([
    [1, "1 day"],
    [7, "7 days"],
  ])("fires at D+%i", async (days, suffix) => {
    const { result, created } = await run({
      rentPeriods: [period({ dueDate: daysFromNow(-days), status: "overdue" })],
    });

    expect(result.overdueNotices).toBe(1);
    expect(created[0]).toMatchObject({ type: "payment_overdue", entityType: "RentPeriod" });
    expect(created[0].title).toContain(suffix);
  });

  it.each([2, 3, 6, 8])("stays quiet at D+%i", async (days) => {
    const { result } = await run({
      rentPeriods: [period({ dueDate: daysFromNow(-days), status: "overdue" })],
    });

    expect(result.overdueNotices).toBe(0);
  });

  it("chases the balance on a part-paid period, which never reaches status overdue", async () => {
    const { result, created } = await run({
      rentPeriods: [
        period({ dueDate: daysFromNow(-1), allocatedAmount: 300, status: "partially_paid" }),
      ],
    });

    expect(result.overdueNotices).toBe(1);
    expect(created[0].message).toContain("€500.00");
  });

  it("sends D+7 even though D+1 was already sent, and neither one twice", async () => {
    const { result } = await run({
      rentPeriods: [period({ dueDate: daysFromNow(-7), status: "overdue" })],
      notifications: [
        {
          userId: "user-1",
          type: "payment_overdue",
          entityType: "RentPeriod",
          entityId: "period-1",
          message: "… overdue by 1 day.",
        },
      ],
    });

    expect(result.overdueNotices).toBe(1);
  });
});

describe("recibo de renda deadline (rent_receipt_due, PT only)", () => {
  it("fires for money allocated four days ago with no filing yet", async () => {
    const { result, created } = await run({ allocations: [allocation()] });

    expect(result.receiptReminders).toBe(1);
    expect(created[0]).toMatchObject({
      type: "rent_receipt_due",
      entityType: "PaymentAllocation",
      entityId: "alloc-1",
    });
    // The tax gate is the caller's, not sendReminderEmail's default.
    expect(sendReminderEmailMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "receiptDeadline",
      expect.objectContaining({ tenant: "Ana Silva" }),
      { gate: "tax" },
    );
  });

  it("ignores a reversed allocation — that money was taken back", async () => {
    const { result } = await run({
      allocations: [allocation({ reversedAt: new Date() })],
    });

    expect(result.receiptReminders).toBe(0);
  });

  it("stops once a recibo exists for that reference month", async () => {
    const { result } = await run({
      allocations: [
        allocation({
          rentPeriod: {
            tenant: { name: "Ana Silva" },
            property: { address: "Rua A 1", country: "PT" },
            rentReceiptFilings: [{ id: "rr-1" }],
          },
        }),
      ],
    });

    expect(result.receiptReminders).toBe(0);
  });

  it("is Portugal-only — a Spanish property has no 5-day recibo obligation", async () => {
    const { result } = await run({
      allocations: [
        allocation({
          rentPeriod: {
            tenant: { name: "Ana Silva" },
            property: { address: "Calle B 2", country: "ES" },
            rentReceiptFilings: [],
          },
        }),
      ],
    });

    expect(result.receiptReminders).toBe(0);
  });
});

describe("all four alert types survive the payment-stack cut", () => {
  it("emits every type in one run", async () => {
    const { result, created } = await run({
      rentPeriods: [
        period({ id: "due-1" }),
        period({ id: "late-1", dueDate: daysFromNow(-1), status: "overdue" }),
      ],
      leases: [
        {
          id: "lease-1",
          userId: "user-1",
          endDate: daysFromNow(60),
          status: "active",
          tenant: { name: "Ana Silva" },
          property: { address: "Rua A 1" },
        },
      ],
      allocations: [allocation()],
    });

    expect(result).toMatchObject({
      rentReminders: 1,
      overdueNotices: 1,
      leaseRenewals: 1,
      receiptReminders: 1,
      errors: [],
    });
    expect(created.map((n) => n.type).sort()).toEqual([
      "lease_renewal_reminder",
      "payment_due",
      "payment_overdue",
      "rent_receipt_due",
    ]);
  });
});
