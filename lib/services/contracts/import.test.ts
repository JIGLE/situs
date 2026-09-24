import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractImport } from "./schema";

/**
 * The import transaction with Prisma stubbed. The real-SQLite run beside it
 * (import.integration.test.ts) proves the encryption and the rows; this pins the decisions: what
 * is created, what is only linked, and that nothing is written for an id the caller does not own.
 */

const { tx, prismaMock, owns, parties, audit, periods } = vi.hoisted(() => {
  const tx = {
    property: { create: vi.fn() },
    propertyOwner: { count: vi.fn(), create: vi.fn() },
    owner: { create: vi.fn() },
    tenant: { create: vi.fn() },
    lease: { create: vi.fn() },
    leaseClause: { createMany: vi.fn() },
  };
  return {
    tx,
    prismaMock: { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) },
    owns: vi.fn(),
    parties: vi.fn(),
    audit: vi.fn(),
    periods: vi.fn(),
  };
});

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/database/assert-owned", () => ({ assertOwnsRelations: owns }));
vi.mock("@/lib/services/database/lease-parties", () => ({ replaceLeaseParties: parties }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: audit }));
vi.mock("@/lib/services/allocation/service", () => ({ generateRentPeriods: periods }));
import { importContract } from "./import";

const lease = {
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  monthlyRent: 950,
  deposit: 1900,
  autoRenew: true,
  renewalNoticeDays: 120,
  atContractNumber: "20240012345",
  atContractVersion: 1,
};

const everythingNew: ContractImport = {
  property: {
    mode: "new",
    name: "Rua Augusta 12",
    address: "Rua Augusta 12, 3.º Esq.",
    cadasterReference: "2321",
    fraction: "C",
    type: "apartment",
    bedrooms: 2,
    bathrooms: 1,
  },
  landlords: [
    {
      mode: "new",
      name: "Maria Fernandes",
      email: "maria@example.pt",
      taxId: "123 456 789",
      share: 50,
    },
    { mode: "existing", id: "owner-paulo", share: 50 },
  ],
  tenant: {
    mode: "new",
    name: "Ana Costa",
    email: "ana.costa@example.pt",
    phone: null,
    taxId: "246 813 571",
    taxCountry: "PT",
  },
  parties: [{ role: "guarantor", name: "Hans Weber", taxId: "DE 123", taxCountry: "DE" }],
  lease,
  clauses: [
    { kind: "renewal", summary: "Renova-se.", quote: "Renova-se automaticamente.", page: 2 },
  ],
};

describe("importContract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    owns.mockResolvedValue(undefined);
    tx.property.create.mockResolvedValue({ id: "property-new" });
    tx.propertyOwner.count.mockResolvedValue(0);
    tx.owner.create.mockResolvedValue({ id: "owner-maria" });
    tx.tenant.create.mockResolvedValue({ id: "tenant-new" });
    tx.lease.create.mockResolvedValue({ id: "lease-new" });
  });

  it("creates what is new, links what exists, and writes it all in one transaction", async () => {
    await expect(importContract("user-1", everythingNew)).resolves.toEqual({
      leaseId: "lease-new",
      propertyId: "property-new",
      tenantId: "tenant-new",
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.property.create.mock.calls[0][0].data).toMatchObject({
      userId: "user-1",
      cadasterReference: "2321",
      fraction: "C",
      rent: 950,
      status: "occupied",
    });
    // A new landlord's NIF is stored as its digits; the existing one is only linked.
    expect(tx.owner.create).toHaveBeenCalledTimes(1);
    expect(tx.owner.create.mock.calls[0][0].data).toMatchObject({
      taxIdentificationNumber: "123456789",
    });
    expect(tx.propertyOwner.create.mock.calls.map((c) => c[0].data)).toEqual([
      { propertyId: "property-new", ownerId: "owner-maria", ownershipPercentage: 50 },
      { propertyId: "property-new", ownerId: "owner-paulo", ownershipPercentage: 50 },
    ]);
    expect(tx.tenant.create.mock.calls[0][0].data).toMatchObject({
      userId: "user-1",
      propertyId: "property-new",
      phone: "",
      taxId: "246813571",
      rent: 950,
    });
    expect(tx.lease.create.mock.calls[0][0].data).toMatchObject({
      propertyId: "property-new",
      tenantId: "tenant-new",
      atContractNumber: "20240012345",
      status: "active",
    });
    // Parties through their own delegate, inside the same transaction.
    expect(parties).toHaveBeenCalledWith(tx, "user-1", "lease-new", everythingNew.parties);
    expect(tx.leaseClause.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ userId: "user-1", leaseId: "lease-new", kind: "renewal", page: 2 }),
    ]);
    expect(periods).toHaveBeenCalledWith("lease-new");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "IMPORT_LEASE_CONTRACT", resourceId: "lease-new" }),
    );
  });

  it("leaves an owned property's shares alone, and edits no existing record", async () => {
    tx.propertyOwner.count.mockResolvedValue(2);

    await importContract("user-1", {
      ...everythingNew,
      property: { mode: "existing", id: "property-1" },
      tenant: { mode: "existing", id: "tenant-1" },
    });

    expect(tx.property.create).not.toHaveBeenCalled();
    expect(tx.tenant.create).not.toHaveBeenCalled();
    expect(tx.owner.create).not.toHaveBeenCalled();
    expect(tx.propertyOwner.create).not.toHaveBeenCalled();
    expect(tx.lease.create.mock.calls[0][0].data).toMatchObject({
      propertyId: "property-1",
      tenantId: "tenant-1",
    });
  });

  it("writes nothing when an id is not the caller's", async () => {
    owns.mockImplementation(async (_user, refs: { ownerId?: string }) => {
      if (refs.ownerId === "owner-paulo") throw new Error("Owner not found");
    });

    await expect(importContract("user-1", everythingNew)).rejects.toThrow("Owner not found");
    expect(owns).toHaveBeenCalledWith("user-1", { ownerId: "owner-paulo" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
