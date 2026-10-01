// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the owner still has to give, read from the records. The rules are `rules.test.ts`'s; this
 * proves what is read, and that every read is the owner's own.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lease: { findMany: vi.fn() },
    property: { findMany: vi.fn() },
    propertyOwner: { findMany: vi.fn() },
    tenant: { findMany: vi.fn() },
    owner: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { getAttention, loadAttentionLeases } from "./gather";

const USER = "owner-1";

beforeEach(() => {
  vi.resetAllMocks();
  prismaMock.lease.findMany.mockResolvedValue([
    { id: "lease-1", propertyId: "property-1", tenantId: "tenant-1", atContractNumber: null },
  ]);
  prismaMock.property.findMany.mockResolvedValue([{ id: "property-1", name: "T2 na Rua Augusta" }]);
  prismaMock.propertyOwner.findMany.mockResolvedValue([
    { propertyId: "property-1", ownerId: "owner-a" },
  ]);
  prismaMock.tenant.findMany.mockResolvedValue([
    { id: "tenant-1", name: "Rui Silva", taxId: null, taxCountry: "PT", idDocument: null },
  ]);
  prismaMock.owner.findMany.mockResolvedValue([
    { id: "owner-a", name: "Ana Costa", taxIdentificationNumber: "123456789" },
  ]);
});

describe("loadAttentionLeases", () => {
  it("puts each active lease with its property, its tenant and its landlords", async () => {
    expect(await loadAttentionLeases(USER)).toEqual([
      {
        id: "lease-1",
        property: "T2 na Rua Augusta",
        contractNumber: null,
        tenant: { id: "tenant-1", name: "Rui Silva", nif: null, country: "PT", document: null },
        landlords: [{ id: "owner-a", name: "Ana Costa", nif: "123456789" }],
      },
    ]);
  });

  it("scopes every read to the owner, so another account's records are never looked at", async () => {
    await loadAttentionLeases(USER);

    expect(prismaMock.lease.findMany.mock.calls[0][0].where).toEqual({
      userId: USER,
      status: "active",
    });
    expect(prismaMock.property.findMany.mock.calls[0][0].where).toMatchObject({ userId: USER });
    // A share links a property to an owner, and has no owner column of its own.
    expect(prismaMock.propertyOwner.findMany.mock.calls[0][0].where).toMatchObject({
      property: { userId: USER },
    });
    expect(prismaMock.tenant.findMany.mock.calls[0][0].where).toMatchObject({ userId: USER });
    expect(prismaMock.owner.findMany.mock.calls[0][0].where).toMatchObject({ userId: USER });
  });

  it("reads people through their own models, never nested, so their NIFs are decrypted", async () => {
    await loadAttentionLeases(USER);

    const select = prismaMock.lease.findMany.mock.calls[0][0].select;
    expect(Object.keys(select).sort()).toEqual([
      "atContractNumber",
      "id",
      "propertyId",
      "tenantId",
    ]);
    expect(prismaMock.owner.findMany.mock.calls[0][0].select).toMatchObject({
      taxIdentificationNumber: true,
    });
    expect(prismaMock.tenant.findMany.mock.calls[0][0].select).toMatchObject({
      taxId: true,
      idDocument: true,
    });
  });

  it("reads nothing more when no lease is active", async () => {
    prismaMock.lease.findMany.mockResolvedValue([]);

    expect(await loadAttentionLeases(USER)).toEqual([]);
    expect(prismaMock.property.findMany).not.toHaveBeenCalled();
    expect(prismaMock.tenant.findMany).not.toHaveBeenCalled();
  });

  it("leaves out a lease whose property or tenant the scoped read did not return", async () => {
    prismaMock.property.findMany.mockResolvedValue([]);
    expect(await loadAttentionLeases(USER)).toEqual([]);

    prismaMock.property.findMany.mockResolvedValue([{ id: "property-1", name: "Rua Augusta" }]);
    prismaMock.tenant.findMany.mockResolvedValue([]);
    expect(await loadAttentionLeases(USER)).toEqual([]);
  });

  it("does not name an owner the scoped read did not return as a landlord", async () => {
    // A share against another account's owner, which the owner read, scoped, leaves out.
    prismaMock.owner.findMany.mockResolvedValue([]);

    const [lease] = await loadAttentionLeases(USER);

    expect(lease.landlords).toEqual([]);
  });
});

describe("getAttention", () => {
  it("lists what is missing, most important first, and counts it", async () => {
    const { items, counts } = await getAttention(USER);

    expect(items.map((item) => item.id)).toEqual([
      "contract_number:lease-1",
      "tenant_nif:tenant-1",
    ]);
    expect(counts).toEqual({ total: 2, blocksReceipt: 2, reminders: 0, niceToHave: 0 });
  });

  it("is empty once everything a receipt needs is there", async () => {
    prismaMock.lease.findMany.mockResolvedValue([
      {
        id: "lease-1",
        propertyId: "property-1",
        tenantId: "tenant-1",
        atContractNumber: "1234567",
      },
    ]);
    prismaMock.tenant.findMany.mockResolvedValue([
      { id: "tenant-1", name: "Rui Silva", taxId: "234567899", taxCountry: "PT", idDocument: null },
    ]);

    expect(await getAttention(USER)).toEqual({
      items: [],
      counts: { total: 0, blocksReceipt: 0, reminders: 0, niceToHave: 0 },
    });
  });
});
