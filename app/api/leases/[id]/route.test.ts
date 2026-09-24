import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * What `PUT /api/leases/[id]` may write.
 *
 * The handler spread the request body straight into `prisma.lease.update`, so a request could set
 * any column — `userId` included, which moved the lease into another account — and could point the
 * lease at another landlord's property or tenant, which `POST /api/leases` refuses. The renewal
 * screen showed the same hole from the other side: it PUT the whole lease back, relation objects
 * and all.
 */

const { prismaMock } = vi.hoisted(() => {
  const prismaMock = {
    lease: { update: vi.fn(), delete: vi.fn() },
    property: { findFirst: vi.fn() },
    tenant: { findFirst: vi.fn() },
    leaseParty: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    // The interactive transaction runs its callback against the same mock.
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prismaMock)),
  };
  return { prismaMock };
});

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1" })),
  requireOwnerAccess: vi.fn(async () => ({ userId: "user-1", scopeUserId: "user-1" })),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { PUT } from "./route";

const put = (body: unknown) =>
  PUT(
    new NextRequest("http://localhost:3000/api/leases/lease-1", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: "lease-1" }) },
  );

const written = () => prismaMock.lease.update.mock.calls[0][0].data as Record<string, unknown>;

describe("PUT /api/leases/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.lease.update.mockImplementation(async ({ data }) => ({ id: "lease-1", ...data }));
    prismaMock.property.findFirst.mockResolvedValue({ id: "prop-1" });
    prismaMock.tenant.findFirst.mockResolvedValue({ id: "tenant-1" });
    prismaMock.leaseParty.findMany.mockResolvedValue([]);
  });

  it("never moves the lease into another account", async () => {
    const res = await put({ monthlyRent: 900, userId: "someone-else" });

    expect(res.status).toBe(200);
    expect(written()).not.toHaveProperty("userId");
    expect(written().monthlyRent).toBe(900);
  });

  it("refuses a property the caller does not own, as POST does", async () => {
    prismaMock.property.findFirst.mockResolvedValue(null);

    const res = await put({ propertyId: "someone-elses-property" });

    expect(res.status).toBe(404);
    expect(prismaMock.lease.update).not.toHaveBeenCalled();
  });

  it("refuses a tenant the caller does not own", async () => {
    prismaMock.tenant.findFirst.mockResolvedValue(null);

    const res = await put({ tenantId: "someone-elses-tenant" });

    expect(res.status).toBe(404);
    expect(prismaMock.lease.update).not.toHaveBeenCalled();
  });

  // The renewal screen PUT back the lease it had just been sent: relation objects, its id, the
  // renewal columns. Only the lease's own terms may be written, and only the ones in the request.
  // `toEqual` also pins the trap in the obvious fix: Zod 4 still applies a `.default()` inside
  // `.partial()`, so an update schema built that way adds `status: "draft"` to this rent change.
  // `unitId` is a column that no longer exists; passed through, Prisma would refuse the update.
  it("writes only the terms it was sent", async () => {
    await put({
      monthlyRent: 800,
      id: "lease-1",
      unitId: "unit-1",
      property: { name: "Rua Augusta 12", address: "Lisboa" },
      tenant: { name: "Ana Costa", email: "ana@example.com" },
      renewalStatus: "accepted",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(written()).toEqual({ monthlyRent: 800 });
  });

  it("answers 400 for a body that is not a lease", async () => {
    const res = await put({ monthlyRent: "a lot" });

    expect(res.status).toBe(400);
    expect(prismaMock.lease.update).not.toHaveBeenCalled();
  });

  // The contract has its own route now, which checks it is a PDF and stores it encrypted. The
  // wizard used to send it here inside the JSON, as `{ type: "Buffer", data: [...] }`.
  it("does not take a contract from the JSON body", async () => {
    await put({ monthlyRent: 800, contractFile: { type: "Buffer", data: [37, 80, 68, 70] } });

    expect(written()).toEqual({ monthlyRent: 800 });
  });

  it("stores AT's contract number and version", async () => {
    await put({ atContractNumber: "20240012345", atContractVersion: 2 });

    expect(written()).toEqual({ atContractNumber: "20240012345", atContractVersion: 2 });
  });

  it("clears the AT contract number with a blank input", async () => {
    await put({ atContractNumber: "" });

    expect(written()).toEqual({ atContractNumber: null });
  });

  it("refuses an AT contract number that is not digits", async () => {
    const res = await put({ atContractNumber: "PT-2024" });

    expect(res.status).toBe(400);
    expect(prismaMock.lease.update).not.toHaveBeenCalled();
  });

  describe("co-tenants and guarantors", () => {
    it("replaces them when sent, after the lease update proves the lease is the caller's", async () => {
      await put({
        parties: [
          { role: "tenant", name: "Rui Costa", taxId: "123 456 789" },
          { role: "guarantor", name: "Hans Weber", taxId: "DE 12345", taxCountry: "DE" },
        ],
      });

      expect(prismaMock.leaseParty.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1", leaseId: "lease-1" },
      });
      expect(prismaMock.leaseParty.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: "user-1",
            leaseId: "lease-1",
            role: "tenant",
            name: "Rui Costa",
            taxCountry: "PT",
            taxId: "123456789",
            idDocument: null,
          },
          {
            userId: "user-1",
            leaseId: "lease-1",
            role: "guarantor",
            name: "Hans Weber",
            taxCountry: "DE",
            taxId: "DE 12345",
            idDocument: null,
          },
        ],
      });
      const [updateOrder] = prismaMock.lease.update.mock.invocationCallOrder;
      const [deleteOrder] = prismaMock.leaseParty.deleteMany.mock.invocationCallOrder;
      expect(updateOrder).toBeLessThan(deleteOrder);
      // Through the transaction, so a lease never keeps half its parties.
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it("leaves them as they are when the request does not send them", async () => {
      await put({ monthlyRent: 800 });

      expect(prismaMock.leaseParty.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.leaseParty.createMany).not.toHaveBeenCalled();
    });

    it("refuses a Portuguese NIF whose check digit is wrong, before writing anything", async () => {
      const res = await put({
        parties: [{ role: "tenant", name: "Rui Costa", taxId: "123456780" }],
      });

      expect(res.status).toBe(400);
      expect(prismaMock.lease.update).not.toHaveBeenCalled();
      expect(prismaMock.leaseParty.deleteMany).not.toHaveBeenCalled();
    });

    it("answers with the parties as stored", async () => {
      prismaMock.leaseParty.findMany.mockResolvedValue([
        { id: "party-1", leaseId: "lease-1", role: "guarantor", name: "Hans Weber" },
      ]);

      const res = await put({ monthlyRent: 800 });
      const body = await res.json();

      expect(body.data.parties).toEqual([{ id: "party-1", role: "guarantor", name: "Hans Weber" }]);
    });
  });
});
