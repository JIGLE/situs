import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `PUT /api/receipts/[id]` rewrites a receipt the caller owns — but the ids it writes INTO it came
 * from the request and were never checked. The update `include`s the full tenant and property, so
 * pointing a receipt at someone else's tenant echoed that tenant's email, phone and rent back.
 * `receiptService.create` has checked these since the ownership sweep; `update` never did.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    receipt: { findUnique: vi.fn(), update: vi.fn() },
    tenant: { findFirst: vi.fn() },
    property: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1" })),
  requireOwnerAccess: vi.fn(async () => ({ userId: "user-1", scopeUserId: "user-1" })),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { PUT } from "./route";

const stored = {
  id: "rec-1",
  userId: "user-1",
  tenantId: "tenant-1",
  propertyId: "prop-1",
  leaseId: null,
  amount: 950,
  date: new Date("2026-03-01T00:00:00.000Z"),
  type: "rent",
  status: "pending",
  description: null,
  createdAt: new Date("2026-03-01T00:00:00.000Z"),
  updatedAt: new Date("2026-03-01T00:00:00.000Z"),
  tenant: { name: "Ana Costa" },
  property: { name: "Rua Augusta 12" },
};

const put = (body: unknown) =>
  PUT(
    new NextRequest("http://localhost:3000/api/receipts/rec-1", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: "rec-1" }) },
  );

describe("PUT /api/receipts/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.receipt.findUnique.mockResolvedValue(stored);
    // Prisma ignores an `undefined` field, so the stand-in must too, or `date: undefined` would
    // wipe the stored date.
    prismaMock.receipt.update.mockImplementation(async ({ data }) => ({
      ...stored,
      ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
    }));
    prismaMock.tenant.findFirst.mockResolvedValue({ id: "tenant-1" });
    prismaMock.property.findFirst.mockResolvedValue({ id: "prop-1" });
  });

  it("refuses a tenant the caller does not own", async () => {
    prismaMock.tenant.findFirst.mockResolvedValue(null);

    const res = await put({ tenantId: "someone-elses-tenant" });

    expect(res.status).toBe(404);
    expect(prismaMock.receipt.update).not.toHaveBeenCalled();
  });

  it("refuses a property the caller does not own", async () => {
    prismaMock.property.findFirst.mockResolvedValue(null);

    const res = await put({ propertyId: "someone-elses-property" });

    expect(res.status).toBe(404);
    expect(prismaMock.receipt.update).not.toHaveBeenCalled();
  });

  // `updateReceiptSchema` was `receiptSchema.partial()`, and Zod 4 still applies a `.default()`
  // inside `.partial()`: an edit that did not mention `status` came back with `status: "paid"`,
  // so correcting a pending receipt's description marked it paid.
  it("leaves the status alone when an update does not send one", async () => {
    const res = await put({ description: "Renda de março" });

    expect(res.status).toBe(200);
    expect(prismaMock.receipt.update.mock.calls[0][0].data.status).toBeUndefined();
  });
});
