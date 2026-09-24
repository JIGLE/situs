import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `POST /api/leases` checks that the caller owns the property and tenant a new lease points at.
 * It did not check the unit: `unitId` is part of the lease schema and was written unchecked, so a
 * lease could be hung on another landlord's unit. A unit has no `userId`; it belongs to whoever
 * owns its property.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lease: { create: vi.fn() },
    property: { findFirst: vi.fn() },
    tenant: { findFirst: vi.fn() },
    unit: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: vi.fn(async () => ({ userId: "user-1", scopeUserId: "user-1" })),
  getAccessContext: vi.fn(),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/allocation/service", () => ({ generateRentPeriods: vi.fn() }));

import { POST } from "./route";

const lease = {
  tenantId: "tenant-1",
  propertyId: "prop-1",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  monthlyRent: 950,
};

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost:3000/api/leases", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("POST /api/leases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.lease.create.mockImplementation(async ({ data }) => ({ id: "lease-1", ...data }));
    prismaMock.property.findFirst.mockResolvedValue({ id: "prop-1" });
    prismaMock.tenant.findFirst.mockResolvedValue({ id: "tenant-1" });
    prismaMock.unit.findFirst.mockResolvedValue({ id: "unit-1" });
  });

  it("creates a lease on the caller's own unit", async () => {
    const res = await post({ ...lease, unitId: "unit-1" });

    expect(res.status).toBe(201);
    expect(prismaMock.unit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "unit-1", property: { userId: "user-1" } } }),
    );
  });

  it("refuses a unit the caller does not own", async () => {
    prismaMock.unit.findFirst.mockResolvedValue(null);

    const res = await post({ ...lease, unitId: "someone-elses-unit" });

    expect(res.status).toBe(404);
    expect(prismaMock.lease.create).not.toHaveBeenCalled();
  });
});
