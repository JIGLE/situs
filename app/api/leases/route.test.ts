import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `POST /api/leases` checks that the caller owns the property and tenant a new lease points at.
 * A lease binds a tenant to a property and drives the rent ledger, so one created against another
 * landlord's records would write into their books.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lease: { create: vi.fn() },
    property: { findFirst: vi.fn() },
    tenant: { findFirst: vi.fn() },
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
  });

  it("creates a lease on the caller's own property and tenant", async () => {
    const res = await post(lease);

    expect(res.status).toBe(201);
    expect(prismaMock.property.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "prop-1", userId: "user-1" } }),
    );
    expect(prismaMock.tenant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tenant-1", userId: "user-1" } }),
    );
  });

  it("refuses a property the caller does not own", async () => {
    prismaMock.property.findFirst.mockResolvedValue(null);

    const res = await post({ ...lease, propertyId: "someone-elses-property" });

    expect(res.status).toBe(404);
    expect(prismaMock.lease.create).not.toHaveBeenCalled();
  });

  it("refuses a tenant the caller does not own", async () => {
    prismaMock.tenant.findFirst.mockResolvedValue(null);

    const res = await post({ ...lease, tenantId: "someone-elses-tenant" });

    expect(res.status).toBe(404);
    expect(prismaMock.lease.create).not.toHaveBeenCalled();
  });

  // The units table is gone. The route spreads the parsed body into the create, so a `unitId` the
  // schema still accepted would reach Prisma, which refuses an unknown column.
  it("does not write a unitId an old client still sends", async () => {
    const res = await post({ ...lease, unitId: "unit-1" });

    expect(res.status).toBe(201);
    expect(prismaMock.lease.create.mock.calls[0][0].data).not.toHaveProperty("unitId");
  });
});
