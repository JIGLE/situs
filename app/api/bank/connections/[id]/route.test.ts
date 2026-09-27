import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A connection's own route: naming it and removing it. What each does is tested in
 * lib/services/bank/connections.test.ts.
 */

const { access, renameMock, removeMock } = vi.hoisted(() => ({
  access: vi.fn(),
  renameMock: vi.fn(),
  removeMock: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: access,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/bank/connections", () => ({
  renameConnection: renameMock,
  removeConnection: removeMock,
}));

import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";
import { DELETE, PATCH } from "./route";

const patch = (body: string, params: Record<string, string> = { id: "conn-1" }) =>
  PATCH(
    new NextRequest("http://localhost:3000/api/bank/connections/conn-1", {
      method: "PATCH",
      body,
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve(params) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
  renameMock.mockImplementation(async (_user: string, id: string, label: string | null) => ({
    connectionId: id,
    label,
  }));
});

describe("PATCH /api/bank/connections/[id]", () => {
  it("names the connection, trimmed, looking only in the owner's own connections", async () => {
    access.mockResolvedValue({ userId: "manager-1", scopeUserId: "owner-1" });

    const res = await patch(JSON.stringify({ label: "  Conta da casa  " }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { connectionId: "conn-1", label: "Conta da casa" } });
    expect(renameMock).toHaveBeenCalledWith("owner-1", "conn-1", "Conta da casa");
  });

  it("goes back to the bank's name for an empty name or none", async () => {
    await patch(JSON.stringify({ label: "   " }));
    await patch(JSON.stringify({ label: null }));

    expect(renameMock.mock.calls.map((call) => call[2])).toEqual([null, null]);
  });

  it("refuses a name longer than 60 characters, or one with control characters, as a 400", async () => {
    for (const label of ["x".repeat(61), "Conta\nda casa"]) {
      const res = await patch(JSON.stringify({ label }));
      expect(res.status).toBe(400);
    }
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("answers a body that is not JSON, or has no label, as a 400", async () => {
    expect((await patch("not json")).status).toBe(400);
    expect((await patch(JSON.stringify({}))).status).toBe(400);
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not an owner before touching anything", async () => {
    access.mockResolvedValue(new Response(null, { status: 403 }));

    const res = await patch(JSON.stringify({ label: "Conta" }));

    expect(res.status).toBe(403);
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("answers another owner's connection as not found", async () => {
    renameMock.mockRejectedValue(new ResourceNotFoundError("Bank connection"));

    const res = await patch(JSON.stringify({ label: "Conta" }));

    expect(res.status).toBe(404);
  });
});

const remove = (params: Record<string, string> = { id: "conn-1" }) =>
  DELETE(
    new NextRequest("http://localhost:3000/api/bank/connections/conn-1", { method: "DELETE" }),
    { params: Promise.resolve(params) },
  );

describe("DELETE /api/bank/connections/[id]", () => {
  beforeEach(() => {
    removeMock.mockResolvedValue({ connectionId: "conn-1", revocation: "revoked" });
  });

  it("removes the connection, looking only in the owner's own connections", async () => {
    access.mockResolvedValue({ userId: "manager-1", scopeUserId: "owner-1" });

    const res = await remove();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { connectionId: "conn-1", revocation: "revoked" } });
    expect(removeMock).toHaveBeenCalledWith("owner-1", "conn-1");
  });

  it("answers a connection with movements as a 409 with its reason", async () => {
    removeMock.mockRejectedValue(
      new ConflictError("A connection with movements", "bank_connection_has_movements"),
    );

    const res = await remove();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "bank_connection_has_movements" });
  });

  it("answers another owner's connection as not found", async () => {
    removeMock.mockRejectedValue(new ResourceNotFoundError("Bank connection"));

    expect((await remove()).status).toBe(404);
  });

  it("needs the connection's id, and an owner", async () => {
    expect((await remove({})).status).toBe(400);
    access.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await remove()).status).toBe(403);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
