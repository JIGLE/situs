import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Pins the validation contract: a malformed body is a 400 the caller can act on, not a 500.
 * The route used to call ownerSchema.parse() directly, so the ZodError reached
 * withErrorHandler — which has no ZodError branch and reports everything as 500.
 *
 * Both handlers admit owners only, as every other collection does, and an owner's NIF, which AT
 * names a landlord by on a receipt, is stored as its nine digits.
 */

const { requireOwnerAccessMock, prismaMock } = vi.hoisted(() => ({
  requireOwnerAccessMock: vi.fn(),
  prismaMock: { owner: { create: vi.fn(), findMany: vi.fn() } },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: requireOwnerAccessMock,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/config/data-mode", () => ({ isMockMode: false }));
import { GET, POST } from "./route";

const postRequest = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/owners", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("POST /api/owners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOwnerAccessMock.mockResolvedValue({ userId: "user-123", scopeUserId: "user-123" });
    prismaMock.owner.create.mockResolvedValue({ id: "owner-1", name: "Ana Costa" });
  });

  it("creates an owner from a valid body", async () => {
    const res = await POST(postRequest({ name: "Ana Costa", email: "ana@example.pt" }));

    expect(res.status).toBe(201);
    expect(prismaMock.owner.create).toHaveBeenCalledWith({
      data: { name: "Ana Costa", email: "ana@example.pt", phone: null, userId: "user-123" },
    });
  });

  it("returns 400 when a required field is missing", async () => {
    const res = await POST(postRequest({ email: "ana@example.pt" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining("Validation error") }),
    );
    expect(prismaMock.owner.create).not.toHaveBeenCalled();
  });

  it("returns 400 with the failing rule when a field is malformed", async () => {
    const res = await POST(postRequest({ name: "Ana Costa", email: "not-an-email" }));

    expect(res.status).toBe(400);
    // The message has to name what went wrong — a bare "Internal server error" gave the
    // caller nothing to fix.
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining("Invalid email address") }),
    );
    expect(prismaMock.owner.create).not.toHaveBeenCalled();
  });

  it("stores a NIF as its nine digits, however it was typed", async () => {
    const res = await POST(
      postRequest({
        name: "Ana Costa",
        email: "ana@example.pt",
        taxIdentificationNumber: "123 456 789",
      }),
    );

    expect(res.status).toBe(201);
    expect(prismaMock.owner.create.mock.calls[0][0].data).toMatchObject({
      taxIdentificationNumber: "123456789",
      userId: "user-123",
    });
  });

  it("stores a blank NIF as none, not as an empty string", async () => {
    await POST(
      postRequest({ name: "Ana Costa", email: "ana@example.pt", taxIdentificationNumber: "" }),
    );

    expect(prismaMock.owner.create.mock.calls[0][0].data.taxIdentificationNumber).toBeNull();
  });

  it("refuses a NIF whose check digit does not match, and creates nothing", async () => {
    const res = await POST(
      postRequest({
        name: "Ana Costa",
        email: "ana@example.pt",
        taxIdentificationNumber: "123456788",
      }),
    );

    expect(res.status).toBe(400);
    expect(prismaMock.owner.create).not.toHaveBeenCalled();
  });

  it("refuses a session that is not an owner's, and touches nothing", async () => {
    requireOwnerAccessMock.mockResolvedValue(new Response(null, { status: 403 }));

    const res = await POST(postRequest({ name: "Ana Costa", email: "ana@example.pt" }));

    expect(res.status).toBe(403);
    expect(prismaMock.owner.create).not.toHaveBeenCalled();
  });
});

/**
 * Finanças names a landlord by NIF and name, so an email and a phone are optional. One that is not
 * there is NULL, never "": an empty string reads as a value, and collides on the unique index.
 */
describe("POST /api/owners: an email or a phone the owner does not have", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    requireOwnerAccessMock.mockResolvedValue({ userId: "user-123", scopeUserId: "user-123" });
    prismaMock.owner.create.mockResolvedValue({ id: "owner-1", name: "Ana Costa" });
  });

  it("creates an owner with only a name, and stores neither", async () => {
    const res = await POST(postRequest({ name: "Ana Costa" }));

    expect(res.status).toBe(201);
    expect(prismaMock.owner.create.mock.calls[0][0].data).toMatchObject({
      email: null,
      phone: null,
    });
  });

  it.each([
    ["an empty string", { email: "", phone: "" }],
    ["spaces", { email: "   ", phone: "   " }],
    ["null, for an email", { email: null }],
  ])(
    "stores an email and a phone sent as %s as NULL, not as an empty string",
    async (_why, blank) => {
      const res = await POST(postRequest({ name: "Ana Costa", ...blank }));

      expect(res.status).toBe(201);
      expect(prismaMock.owner.create.mock.calls[0][0].data).toMatchObject({
        email: null,
        phone: null,
      });
    },
  );

  it("answers an email the account already has as a 409 the screen can word", async () => {
    // Prisma's error for a write that breaks the account's (userId, email) unique index.
    prismaMock.owner.create.mockRejectedValue({ code: "P2002" });

    const res = await POST(postRequest({ name: "Ana Costa", email: "ana@example.pt" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "email_in_use" });
  });

  it("does not take another failure for a duplicate email", async () => {
    prismaMock.owner.create.mockRejectedValue(new Error("database is locked"));

    const res = await POST(postRequest({ name: "Ana Costa", email: "ana@example.pt" }));

    expect(res.status).toBe(500);
  });
});

describe("GET /api/owners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOwnerAccessMock.mockResolvedValue({ userId: "user-123", scopeUserId: "user-123" });
    prismaMock.owner.findMany.mockResolvedValue([]);
  });

  it("lists the caller's owners only", async () => {
    const res = await GET(new NextRequest("http://localhost:3000/api/owners"));

    expect(res.status).toBe(200);
    expect(prismaMock.owner.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: "user-123" },
    });
  });

  it("refuses a session that is not an owner's", async () => {
    requireOwnerAccessMock.mockResolvedValue(new Response(null, { status: 403 }));

    expect((await GET(new NextRequest("http://localhost:3000/api/owners"))).status).toBe(403);
    expect(prismaMock.owner.findMany).not.toHaveBeenCalled();
  });
});
