/**
 * A tenant, a property or a lease with money history is kept.
 *
 * Lease, Receipt, RentPeriod and RentReceipt are all `onDelete: Cascade` from Tenant and from
 * Property, and RentPeriod — with every allocation on it — from Lease. So deleting a tenant took
 * their leases, receipts, rent ledger and AT filing records; a property took the same plus its
 * expenses; and a lease took its rent months and the payments allocated to them. Each delete now
 * counts what it would take first, and refuses with a 409 whose `reason` the screen turns into a
 * sentence (`lib/utils/api-error.ts`).
 *
 * Through the three real route handlers and their real services; only Prisma is a stand-in, so a
 * guard that exists but is never called still fails here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, counts } = vi.hoisted(() => {
  const counts: Record<string, number> = {};
  const count = (model: string) => vi.fn(async (_args: unknown) => counts[model] ?? 0);
  const at = new Date("2026-01-01T00:00:00.000Z");
  return {
    counts,
    prismaMock: {
      tenant: {
        findFirst: vi.fn(async () => ({
          id: "t-1",
          userId: "user-1",
          name: "Ana Costa",
          propertyId: null,
          leaseStart: at,
          leaseEnd: at,
          lastPayment: null,
          notes: null,
          property: null,
          receipts: [],
          createdAt: at,
          updatedAt: at,
        })),
        delete: vi.fn(async () => ({})),
      },
      property: {
        findUnique: vi.fn(async () => ({
          id: "p-1",
          userId: "user-1",
          name: "Rua Augusta 12",
          tenants: [],
          receipts: [],
          createdAt: at,
          updatedAt: at,
        })),
        delete: vi.fn(async () => ({})),
      },
      lease: { count: count("lease"), delete: vi.fn(async () => ({})) },
      receipt: { count: count("receipt") },
      rentPeriod: { count: count("rentPeriod") },
      rentReceipt: { count: count("rentReceipt") },
      expense: { count: count("expense") },
      paymentAllocation: { count: count("paymentAllocation") },
    },
  };
});

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1" })),
  requireOwnerAccess: vi.fn(async () => ({ userId: "user-1", scopeUserId: "user-1" })),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import * as tenants from "@/app/api/tenants/[id]/route";
import * as properties from "@/app/api/properties/[id]/route";
import * as leases from "@/app/api/leases/[id]/route";

type Handler = (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;

const del = (handler: Handler, id: string) =>
  handler(new NextRequest(`http://localhost:3000/api/records/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

const cases = [
  {
    entity: "tenant",
    handler: tenants.DELETE as Handler,
    id: "t-1",
    remove: prismaMock.tenant.delete,
    history: ["lease", "receipt", "rentPeriod", "rentReceipt"],
  },
  {
    entity: "property",
    handler: properties.DELETE as Handler,
    id: "p-1",
    remove: prismaMock.property.delete,
    history: ["lease", "receipt", "rentPeriod", "rentReceipt", "expense"],
  },
  {
    entity: "lease",
    handler: leases.DELETE as Handler,
    id: "l-1",
    remove: prismaMock.lease.delete,
    history: ["receipt", "paymentAllocation", "rentReceipt"],
  },
] as const;

const countMocks = () =>
  Object.values(prismaMock).flatMap((model) =>
    "count" in model ? [model.count as ReturnType<typeof vi.fn>] : [],
  );

describe("a record with money history is kept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const model of Object.keys(counts)) delete counts[model];
  });

  describe.each(cases)("DELETE the $entity", ({ entity, handler, id, remove, history }) => {
    it.each(history)("refuses while it has a %s, and deletes nothing", async (model) => {
      counts[model] = 1;

      const res = await del(handler, id);

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ reason: `${entity}_has_history` });
      expect(remove).not.toHaveBeenCalled();
    });

    it("deletes it when nothing is recorded against it", async () => {
      const res = await del(handler, id);

      expect(res.status).toBe(200);
      expect(remove).toHaveBeenCalledWith({ where: { id, userId: "user-1" } });
    });

    it("counts only the caller's own records", async () => {
      await del(handler, id);

      const calls = countMocks().flatMap((mock) => mock.mock.calls);
      expect(calls.length).toBeGreaterThan(0);
      for (const [args] of calls) {
        expect(args).toMatchObject({ where: { userId: "user-1" } });
      }
    });
  });

  // A lease entered by mistake has rent months generated from it, and nothing paid: it can go.
  // A payment that was undone (a reversed allocation) is not history either.
  it("asks a lease only about live allocations, not reversed ones", async () => {
    await del(leases.DELETE as Handler, "l-1");

    expect(prismaMock.paymentAllocation.count).toHaveBeenCalledWith({
      where: { userId: "user-1", reversedAt: null, rentPeriod: { leaseId: "l-1" } },
    });
    expect(prismaMock.rentPeriod.count).not.toHaveBeenCalled();
  });
});
