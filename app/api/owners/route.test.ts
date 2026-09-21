import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Pins the validation contract: a malformed body is a 400 the caller can act on, not a 500.
 * The route used to call ownerSchema.parse() directly, so the ZodError reached
 * withErrorHandler — which has no ZodError branch and reports everything as 500.
 */

const { requireAuthMock, prismaMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  prismaMock: { owner: { create: vi.fn(), findMany: vi.fn() } },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: requireAuthMock,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/config/data-mode", () => ({ isMockMode: false }));
import { POST } from "./route";

const postRequest = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/owners", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("POST /api/owners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: "user-123" });
    prismaMock.owner.create.mockResolvedValue({ id: "owner-1", name: "Ana Costa" });
  });

  it("creates an owner from a valid body", async () => {
    const res = await POST(postRequest({ name: "Ana Costa", email: "ana@example.pt" }));

    expect(res.status).toBe(201);
    expect(prismaMock.owner.create).toHaveBeenCalledWith({
      data: { name: "Ana Costa", email: "ana@example.pt", userId: "user-123" },
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
});
