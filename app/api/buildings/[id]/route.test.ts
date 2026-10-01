import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `PUT /api/buildings/[id]` edits one of the caller's buildings. It used to call
 * `buildingSchema.partial().parse(...)` bare, so valid JSON that failed the schema, such as an
 * empty name, threw a raw `ZodError`, which `withErrorHandler` answers as a 500. It is a 400 now,
 * through `parseBody`, like every other route.
 */

const { requireAuthMock, findFirstMock, updateMock, deleteMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findFirstMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => ({
    building: { findFirst: findFirstMock, update: updateMock, delete: deleteMock },
  }),
}));

import { PUT, DELETE } from "./route";

const context = { params: Promise.resolve({ id: "b1" }) };
const request = (method: string, body?: string) =>
  new NextRequest("http://localhost:3000/api/buildings/b1", {
    method,
    body,
    headers: { "Content-Type": "application/json" },
  });

describe("PUT /api/buildings/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    requireAuthMock.mockResolvedValue({ userId: "user-1" });
    findFirstMock.mockResolvedValue({ id: "b1", userId: "user-1", name: "Edifício Sol" });
    updateMock.mockImplementation(async ({ data }) => ({
      id: "b1",
      name: "Edifício Sol",
      ...data,
      _count: { properties: 3 },
    }));
  });

  it("saves an edit to the caller's building", async () => {
    const res = await PUT(request("PUT", JSON.stringify({ name: "Edifício Lua" })), context);

    expect(res.status).toBe(200);
    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: "b1", userId: "user-1" } });
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      where: { id: "b1" },
      data: { name: "Edifício Lua" },
    });
    expect((await res.json()).data).toMatchObject({ name: "Edifício Lua", propertyCount: 3 });
  });

  it.each([
    ["an empty name", { name: "" }],
    ["a name of the wrong type", { name: 5 }],
    ["a name that is too long", { name: "x".repeat(101) }],
  ])("answers %s as a 400, and saves nothing", async (_what, body) => {
    const res = await PUT(request("PUT", JSON.stringify(body)), context);

    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("answers a body that is not JSON, or JSON null, as a 400", async () => {
    expect((await PUT(request("PUT", "{name: x"), context)).status).toBe(400);
    expect((await PUT(request("PUT", "null"), context)).status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("answers another owner's building as a 404 before it reads the body", async () => {
    findFirstMock.mockResolvedValue(null);

    const res = await PUT(request("PUT", JSON.stringify({ name: "Edifício Lua" })), context);

    expect(res.status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("answers the sign-in it is refused as it is, and touches nothing", async () => {
    requireAuthMock.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await PUT(request("PUT", JSON.stringify({ name: "x" })), context);

    expect(res.status).toBe(401);
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/buildings/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    requireAuthMock.mockResolvedValue({ userId: "user-1" });
    findFirstMock.mockResolvedValue({ id: "b1", userId: "user-1" });
  });

  it("removes the caller's building, found by its id and their own", async () => {
    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(200);
    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: "b1", userId: "user-1" } });
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: "b1" } });
  });

  it("answers another owner's building as a 404, and removes nothing", async () => {
    findFirstMock.mockResolvedValue(null);

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(404);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
