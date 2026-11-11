import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The route these cover did not exist until 2026-11 — `property-detail-view.tsx` had been posting
 * to it since 2026-07-19, so assigning or removing a property owner 404'd. The cases below pin the
 * parts that are easy to get wrong: the cross-user scoping, the 100% cap, which the client checks
 * but cannot enforce, and the dated shares: a change closes the old row rather than overwriting
 * it, so who owned the property before stays on record.
 */

const { requireAuthMock, logAuditMock, prismaMock } = vi.hoisted(() => {
  const prisma = {
    property: { findFirst: vi.fn() },
    owner: { findFirst: vi.fn() },
    propertyOwner: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { requireAuthMock: vi.fn(), logAuditMock: vi.fn(), prismaMock: prisma };
});

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: requireAuthMock,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/config/data-mode", () => ({ isMockMode: false }));

import { POST, DELETE } from "./route";

const TODAY = new Date("2026-11-11T00:00:00.000Z");
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const postRequest = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/property-owners", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const deleteRequest = (qs: string) =>
  new NextRequest(`http://localhost:3000/api/property-owners?${qs}`, { method: "DELETE" });

function share(over: Record<string, unknown> = {}) {
  return {
    id: "po-1",
    ownerId: "owner-1",
    ownershipPercentage: 60,
    validFrom: null,
    validTo: null,
    createdAt: day("2026-01-10"),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T15:00:00.000Z"));
  requireAuthMock.mockResolvedValue({ userId: "user-123" });
  logAuditMock.mockResolvedValue(undefined);
  prismaMock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock));
  prismaMock.property.findFirst.mockResolvedValue({ id: "prop-1" });
  prismaMock.owner.findFirst.mockResolvedValue({ id: "owner-1", name: "Ana Costa" });
  prismaMock.propertyOwner.findMany.mockResolvedValue([]);
  prismaMock.propertyOwner.create.mockImplementation(({ data }) => ({ id: "po-new", ...data }));
  prismaMock.propertyOwner.update.mockImplementation(({ where, data }) => ({
    id: where.id,
    ...data,
  }));
  prismaMock.propertyOwner.delete.mockResolvedValue({ id: "po-1" });
});

afterEach(() => vi.useRealTimers());

describe("POST /api/property-owners", () => {
  it("gives an owner's first share, undated, from the beginning, and records an audit entry", async () => {
    const res = await POST(
      postRequest({ propertyId: "prop-1", ownerId: "owner-1", ownershipPercentage: 40 }),
    );

    expect(res.status).toBe(201);
    expect(prismaMock.propertyOwner.create).toHaveBeenCalledWith({
      data: { propertyId: "prop-1", ownerId: "owner-1", ownershipPercentage: 40, validFrom: null },
    });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-123", action: "ASSIGN_PROPERTY_OWNER" }),
    );
  });

  it("dates a first share when told the day it took effect", async () => {
    await POST(
      postRequest({
        propertyId: "prop-1",
        ownerId: "owner-1",
        ownershipPercentage: 40,
        effectiveFrom: "2026-06-01",
      }),
    );
    expect(prismaMock.propertyOwner.create.mock.calls[0][0].data.validFrom).toEqual(
      day("2026-06-01"),
    );
  });

  it("closes the owner's current share and opens the new one, so the old stays on record", async () => {
    prismaMock.propertyOwner.findMany.mockResolvedValue([share()]);

    const res = await POST(
      postRequest({ propertyId: "prop-1", ownerId: "owner-1", ownershipPercentage: 80 }),
    );

    expect(res.status).toBe(201);
    expect(prismaMock.propertyOwner.update).toHaveBeenCalledWith({
      where: { id: "po-1" },
      data: { validTo: TODAY },
    });
    expect(prismaMock.propertyOwner.create.mock.calls[0][0].data).toMatchObject({
      ownershipPercentage: 80,
      validFrom: TODAY,
    });
  });

  it("corrects in place a share that began the same day", async () => {
    prismaMock.propertyOwner.findMany.mockResolvedValue([share({ validFrom: TODAY })]);

    await POST(postRequest({ propertyId: "prop-1", ownerId: "owner-1", ownershipPercentage: 70 }));

    expect(prismaMock.propertyOwner.update).toHaveBeenCalledWith({
      where: { id: "po-1" },
      data: { ownershipPercentage: 70 },
    });
    expect(prismaMock.propertyOwner.create).not.toHaveBeenCalled();
  });

  it("scopes the property to the caller", async () => {
    await POST(postRequest({ propertyId: "prop-1", ownerId: "owner-1", ownershipPercentage: 40 }));
    expect(prismaMock.property.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "prop-1", userId: "user-123" } }),
    );
  });

  it.each([
    ["property", prismaMock.property.findFirst],
    ["owner", prismaMock.owner.findFirst],
  ])("404s on another user's %s rather than attaching to it", async (_label, lookup) => {
    lookup.mockResolvedValue(null);
    const res = await POST(
      postRequest({ propertyId: "prop-1", ownerId: "owner-1", ownershipPercentage: 40 }),
    );
    expect(res.status).toBe(404);
    expect(prismaMock.propertyOwner.create).not.toHaveBeenCalled();
  });

  it("rejects a share that pushes the shares in force past 100%, counting no closed one", async () => {
    prismaMock.propertyOwner.findMany.mockResolvedValue([
      share({ id: "a", ownerId: "owner-2", ownershipPercentage: 60 }),
      share({ id: "b", ownerId: "owner-3", ownershipPercentage: 25 }),
      // Sold last year: not in force, so not counted.
      share({ id: "c", ownerId: "owner-4", ownershipPercentage: 90, validTo: day("2025-12-31") }),
    ]);
    const res = await POST(
      postRequest({ propertyId: "prop-1", ownerId: "owner-1", ownershipPercentage: 20 }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/exceeds 100%/);
    expect(prismaMock.propertyOwner.create).not.toHaveBeenCalled();
  });

  it("allows a share that lands exactly on 100%, and replaces the owner's own share", async () => {
    prismaMock.propertyOwner.findMany.mockResolvedValue([
      share({ id: "a", ownerId: "owner-2", ownershipPercentage: 20 }),
      // Ana holds 60%: moving her to 80% must not read as 20 + 60 + 80.
      share(),
    ]);
    const res = await POST(
      postRequest({ propertyId: "prop-1", ownerId: "owner-1", ownershipPercentage: 80 }),
    );
    expect(res.status).toBe(201);
  });

  it("refuses a change in the future, or before the property's last change", async () => {
    prismaMock.propertyOwner.findMany.mockResolvedValue([share({ validFrom: day("2026-09-15") })]);

    for (const effectiveFrom of ["2026-11-12", "2026-09-01"]) {
      const res = await POST(
        postRequest({
          propertyId: "prop-1",
          ownerId: "owner-2",
          ownershipPercentage: 10,
          effectiveFrom,
        }),
      );
      expect(res.status).toBe(400);
    }
    expect(prismaMock.propertyOwner.create).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", 0],
    ["negative", -10],
    ["above 100", 140],
  ])("rejects a %s percentage", async (_label, pct) => {
    const res = await POST(
      postRequest({ propertyId: "prop-1", ownerId: "owner-1", ownershipPercentage: pct }),
    );
    expect(res.status).toBe(400);
    expect(prismaMock.propertyOwner.create).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    requireAuthMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    const res = await POST(
      postRequest({ propertyId: "prop-1", ownerId: "owner-1", ownershipPercentage: 40 }),
    );
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/property-owners", () => {
  it("ends the owner's share today, keeps it, and records an audit entry", async () => {
    prismaMock.propertyOwner.findMany.mockResolvedValue([share()]);

    const res = await DELETE(deleteRequest("propertyId=prop-1&ownerId=owner-1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ data: { endedOn: "2026-11-11" } });
    expect(prismaMock.propertyOwner.update).toHaveBeenCalledWith({
      where: { id: "po-1" },
      data: { validTo: TODAY },
    });
    expect(prismaMock.propertyOwner.delete).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "REMOVE_PROPERTY_OWNER" }),
    );
  });

  it("ends it on the day given", async () => {
    prismaMock.propertyOwner.findMany.mockResolvedValue([share()]);
    await DELETE(deleteRequest("propertyId=prop-1&ownerId=owner-1&effectiveTo=2026-10-01"));
    expect(prismaMock.propertyOwner.update.mock.calls[0][0].data).toEqual({
      validTo: day("2026-10-01"),
    });
  });

  it.each([
    ["began today", share({ validFrom: TODAY })],
    ["was entered today, undated", share({ createdAt: new Date("2026-11-11T09:00:00.000Z") })],
  ])("deletes a share that %s: a mistake, not history", async (_label, row) => {
    prismaMock.propertyOwner.findMany.mockResolvedValue([row]);
    await DELETE(deleteRequest("propertyId=prop-1&ownerId=owner-1"));
    expect(prismaMock.propertyOwner.delete).toHaveBeenCalledWith({ where: { id: "po-1" } });
    expect(prismaMock.propertyOwner.update).not.toHaveBeenCalled();
  });

  it("404s on another user's property", async () => {
    prismaMock.property.findFirst.mockResolvedValue(null);
    const res = await DELETE(deleteRequest("propertyId=someone-elses&ownerId=owner-1"));
    expect(res.status).toBe(404);
    expect(prismaMock.propertyOwner.update).not.toHaveBeenCalled();
  });

  it("404s when the owner holds no share in force on the property", async () => {
    prismaMock.propertyOwner.findMany.mockResolvedValue([share({ validTo: day("2026-05-01") })]);
    const res = await DELETE(deleteRequest("propertyId=prop-1&ownerId=owner-1"));
    expect(res.status).toBe(404);
    expect(prismaMock.propertyOwner.update).not.toHaveBeenCalled();
  });

  it("400s when the query parameters are missing", async () => {
    const res = await DELETE(deleteRequest("propertyId=prop-1"));
    expect(res.status).toBe(400);
  });
});
