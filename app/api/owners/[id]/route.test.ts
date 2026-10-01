import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `PUT` and `DELETE /api/owners/[id]`: the owner screen's save and delete.
 *
 * The screen called both and found no route, so an owner could be created and never changed,
 * and nothing stored the NIF AT names a landlord by on a receipt. The history guard is the real
 * one, with only Prisma a stand-in, so a guard that exists but is never called fails here.
 */

const { requireOwnerAccessMock, prismaMock } = vi.hoisted(() => ({
  requireOwnerAccessMock: vi.fn(),
  prismaMock: {
    owner: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    propertyOwner: { count: vi.fn() },
    incomeDistributionShare: { count: vi.fn() },
  },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: requireOwnerAccessMock,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { PUT, DELETE } from "./route";

const context = { params: Promise.resolve({ id: "o1" }) };
const request = (method: string, body?: string) =>
  new NextRequest("http://localhost:3000/api/owners/o1", {
    method,
    body,
    headers: { "Content-Type": "application/json" },
  });
const put = (body: unknown) => PUT(request("PUT", JSON.stringify(body)), context);

describe("PUT /api/owners/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    requireOwnerAccessMock.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
    prismaMock.owner.findFirst.mockResolvedValue({ id: "o1", userId: "user-1", name: "Ana" });
    prismaMock.owner.update.mockImplementation(async ({ data }) => ({
      id: "o1",
      name: "Ana Costa",
      ...data,
      properties: [],
    }));
  });

  it("saves an edit to the caller's owner, found by its id and their own", async () => {
    const res = await put({ phone: "+351 912 345 678" });

    expect(res.status).toBe(200);
    expect(prismaMock.owner.findFirst).toHaveBeenCalledWith({
      where: { id: "o1", userId: "user-1" },
    });
    expect(prismaMock.owner.update.mock.calls[0][0]).toMatchObject({
      where: { id: "o1" },
      data: { phone: "+351 912 345 678" },
    });
    expect((await res.json()).data).toMatchObject({ id: "o1", phone: "+351 912 345 678" });
  });

  it("stores a NIF as its nine digits, however it was typed", async () => {
    const res = await put({ taxIdentificationNumber: "123 456 789" });

    expect(res.status).toBe(200);
    expect(prismaMock.owner.update.mock.calls[0][0].data).toEqual({
      taxIdentificationNumber: "123456789",
    });
  });

  it("clears the NIF when it is sent blank, and leaves it alone when it is not sent", async () => {
    await put({ taxIdentificationNumber: "" });
    expect(prismaMock.owner.update.mock.calls[0][0].data).toEqual({
      taxIdentificationNumber: null,
    });

    await put({ phone: "1" });
    expect(prismaMock.owner.update.mock.calls[1][0].data).not.toHaveProperty(
      "taxIdentificationNumber",
    );
  });

  it("clears an email or a phone sent blank, and leaves them alone when they are not sent", async () => {
    await put({ email: "", phone: "" });
    expect(prismaMock.owner.update.mock.calls[0][0].data).toEqual({ email: null, phone: null });

    await put({ name: "Ana Costa-Silva" });
    const { data } = prismaMock.owner.update.mock.calls[1][0];
    expect(data.email).toBeUndefined();
    expect(data.phone).toBeUndefined();
  });

  it("answers an email another owner of the account has as a 409 the screen can word", async () => {
    prismaMock.owner.update.mockRejectedValue({ code: "P2002" });

    const res = await put({ email: "ana@example.pt" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "email_in_use" });
  });

  it("answers a NIF whose check digit does not match as a 400, and saves nothing", async () => {
    const res = await put({ taxIdentificationNumber: "123456788" });

    expect(res.status).toBe(400);
    expect(prismaMock.owner.update).not.toHaveBeenCalled();
  });

  it("never writes a column the schema does not name", async () => {
    await put({ phone: "1", userId: "someone-else", id: "o2", role: "ADMIN" });

    expect(prismaMock.owner.update.mock.calls[0][0].data).toEqual({ phone: "1" });
  });

  it("answers a body that is not JSON, or an empty name, as a 400", async () => {
    expect((await PUT(request("PUT", "{name: x"), context)).status).toBe(400);
    expect((await put({ name: "" })).status).toBe(400);
    expect(prismaMock.owner.update).not.toHaveBeenCalled();
  });

  it("answers another owner's record as a 404, before it reads the body", async () => {
    prismaMock.owner.findFirst.mockResolvedValue(null);

    const res = await PUT(request("PUT", "{not json"), context);

    expect(res.status).toBe(404);
    expect(prismaMock.owner.update).not.toHaveBeenCalled();
  });

  it("refuses a session that is not an owner's, and touches nothing", async () => {
    requireOwnerAccessMock.mockResolvedValue(new Response(null, { status: 403 }));

    const res = await put({ phone: "1" });

    expect(res.status).toBe(403);
    expect(prismaMock.owner.findFirst).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/owners/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    requireOwnerAccessMock.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
    prismaMock.owner.findFirst.mockResolvedValue({ id: "o1", userId: "user-1" });
    prismaMock.propertyOwner.count.mockResolvedValue(0);
    prismaMock.incomeDistributionShare.count.mockResolvedValue(0);
  });

  it("removes an owner with nothing recorded against them", async () => {
    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(200);
    expect(prismaMock.owner.findFirst).toHaveBeenCalledWith({
      where: { id: "o1", userId: "user-1" },
    });
    expect(prismaMock.owner.delete).toHaveBeenCalledWith({ where: { id: "o1" } });
  });

  it.each([
    ["is a landlord of a property", prismaMock.propertyOwner.count],
    ["has a share in an income distribution", prismaMock.incomeDistributionShare.count],
  ])("keeps an owner who %s, with a 409 the screen can word", async (_why, count) => {
    count.mockResolvedValue(1);

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "owner_has_history" });
    expect(prismaMock.owner.delete).not.toHaveBeenCalled();
  });

  it("counts only this owner's links, through the owner's own account", async () => {
    await DELETE(request("DELETE"), context);

    const where = { ownerId: "o1", owner: { userId: "user-1" } };
    expect(prismaMock.propertyOwner.count).toHaveBeenCalledWith({ where });
    expect(prismaMock.incomeDistributionShare.count).toHaveBeenCalledWith({ where });
  });

  it("answers another owner's record as a 404, and removes nothing", async () => {
    prismaMock.owner.findFirst.mockResolvedValue(null);

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(404);
    expect(prismaMock.owner.delete).not.toHaveBeenCalled();
  });
});
