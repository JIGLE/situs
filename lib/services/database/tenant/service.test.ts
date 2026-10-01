import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `tenantService.create` checks the property a tenant is filed under; `update` wrote a new
 * `propertyId` unchecked. The update `include`s the property, so re-pointing a tenant at someone
 * else's property echoed that property's full record back.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    tenant: { create: vi.fn(), update: vi.fn() },
    property: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { tenantService } from "./service";

describe("tenantService.update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A stored row, as the service maps it: dates are Dates, as Prisma returns them.
    prismaMock.tenant.update.mockImplementation(async ({ data }) => ({
      id: "tenant-1",
      userId: "user-1",
      name: "Ana Costa",
      propertyId: data.propertyId,
      leaseStart: new Date("2026-01-01T00:00:00.000Z"),
      leaseEnd: new Date("2026-12-31T00:00:00.000Z"),
      lastPayment: null,
      notes: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      property: { name: "Rua Augusta 12" },
    }));
  });

  it("refuses a property the caller does not own", async () => {
    prismaMock.property.findFirst.mockResolvedValue(null);

    await expect(
      tenantService.update("user-1", "tenant-1", { propertyId: "someone-elses-property" }),
    ).rejects.toThrow("Property not found");
    expect(prismaMock.tenant.update).not.toHaveBeenCalled();
  });

  it("checks the property against the caller", async () => {
    prismaMock.property.findFirst.mockResolvedValue({ id: "prop-1" });

    await tenantService.update("user-1", "tenant-1", { propertyId: "prop-1" });

    expect(prismaMock.property.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "prop-1", userId: "user-1" } }),
    );
    expect(prismaMock.tenant.update).toHaveBeenCalledTimes(1);
  });
});

/**
 * Finanças names a tenant by NIF and name, so an email and a phone number are optional. One that is
 * not there is NULL, never `""`: an empty string reads as a value to every check for one, and
 * collides on the per-account unique index, where NULL does not.
 */
describe("tenantService — an email or a phone the owner does not have", () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    id: "tenant-1",
    userId: "user-1",
    name: "Ana Costa",
    email: null,
    phone: null,
    propertyId: null,
    rent: 0,
    leaseStart: new Date("2026-01-01T00:00:00.000Z"),
    leaseEnd: new Date("2026-12-31T00:00:00.000Z"),
    lastPayment: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    property: null,
    ...over,
  });
  const base = { name: "Ana Costa", rent: 0, leaseStart: "", leaseEnd: "" };

  beforeEach(() => {
    vi.clearAllMocks();
    // What Prisma writes: a field the call leaves undefined keeps the stored value.
    const written = (data: Record<string, unknown>) =>
      stored(Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
    prismaMock.tenant.create.mockImplementation(async ({ data }) => written(data));
    prismaMock.tenant.update.mockImplementation(async ({ data }) => written(data));
  });

  it("stores a blank email and phone as NULL on create, and gives them back as null", async () => {
    const tenant = await tenantService.create("user-1", { ...base, email: "  ", phone: "" });

    expect(prismaMock.tenant.create.mock.calls[0][0].data).toMatchObject({
      email: null,
      phone: null,
    });
    expect(tenant.email).toBeNull();
    expect(tenant.phone).toBeNull();
  });

  it("stores neither when the request names neither", async () => {
    await tenantService.create("user-1", { ...base, email: null, phone: null });

    expect(prismaMock.tenant.create.mock.calls[0][0].data).toMatchObject({
      email: null,
      phone: null,
    });
  });

  it("stores the ones that are given, trimmed", async () => {
    await tenantService.create("user-1", {
      ...base,
      email: " ana@example.com ",
      phone: " 912 345 678 ",
    });

    expect(prismaMock.tenant.create.mock.calls[0][0].data).toMatchObject({
      email: "ana@example.com",
      phone: "912 345 678",
    });
  });

  it("leaves them as they are when an update does not mention them, and clears them on a blank", async () => {
    await tenantService.update("user-1", "tenant-1", { name: "Ana Costa-Silva" });
    await tenantService.update("user-1", "tenant-1", { email: "", phone: null });

    const [untouched, cleared] = prismaMock.tenant.update.mock.calls.map(([call]) => call.data);
    expect(untouched.email).toBeUndefined();
    expect(untouched.phone).toBeUndefined();
    expect(cleared).toMatchObject({ email: null, phone: null });
  });

  it("answers an email the account already has as a 409 `email_in_use`, on create and on update", async () => {
    // Prisma's error for a write that breaks the account's (userId, email) unique index.
    prismaMock.tenant.create.mockRejectedValue({ code: "P2002" });
    prismaMock.tenant.update.mockRejectedValue({ code: "P2002" });

    await expect(
      tenantService.create("user-1", { ...base, email: "ana@example.com", phone: null }),
    ).rejects.toMatchObject({ name: "EmailInUseError", reason: "email_in_use" });
    await expect(
      tenantService.update("user-1", "tenant-1", { email: "ana@example.com" }),
    ).rejects.toMatchObject({ name: "EmailInUseError", reason: "email_in_use" });
  });

  it("does not take any other failure for a duplicate email", async () => {
    const outage = new Error("database is locked");
    prismaMock.tenant.create.mockRejectedValue(outage);

    await expect(
      tenantService.create("user-1", { ...base, email: "ana@example.com", phone: null }),
    ).rejects.toBe(outage);
  });
});
