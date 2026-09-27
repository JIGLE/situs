import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The disconnect route: who may disconnect, whose connection it looks in, and that each refusal
 * reaches the screen as itself. What a disconnect does is tested in
 * lib/services/bank/connections.test.ts.
 */

const { access, disconnectMock } = vi.hoisted(() => ({
  access: vi.fn(),
  disconnectMock: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: access,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/bank/connections", () => ({ disconnectConnection: disconnectMock }));

import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";
import { POST } from "./route";

const disconnect = (params: Record<string, string> = { id: "conn-1" }) =>
  POST(
    new NextRequest("http://localhost:3000/api/bank/connections/conn-1/disconnect", {
      method: "POST",
    }),
    { params: Promise.resolve(params) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
  disconnectMock.mockResolvedValue({ connectionId: "conn-1", revocation: "revoked" });
});

describe("POST /api/bank/connections/[id]/disconnect", () => {
  it("refuses a caller who is not an owner before touching anything", async () => {
    access.mockResolvedValue(new Response(null, { status: 403 }));

    const res = await disconnect();

    expect(res.status).toBe(403);
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("needs the connection's id", async () => {
    const res = await disconnect({});

    expect(res.status).toBe(400);
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("says how asking the bank went, looking only in the owner's own connections", async () => {
    access.mockResolvedValue({ userId: "manager-1", scopeUserId: "owner-1" });
    disconnectMock.mockResolvedValue({ connectionId: "conn-1", revocation: "no_consent_id" });

    const res = await disconnect();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { connectionId: "conn-1", revocation: "no_consent_id" },
    });
    expect(disconnectMock).toHaveBeenCalledWith("owner-1", "conn-1");
  });

  it("answers a connection that changed meanwhile as a 409 with its reason", async () => {
    disconnectMock.mockRejectedValue(
      new ConflictError("The connection changed", "bank_connection_changed"),
    );

    const res = await disconnect();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "bank_connection_changed" });
  });

  it("answers another owner's connection as not found", async () => {
    disconnectMock.mockRejectedValue(new ResourceNotFoundError("Bank connection"));

    const res = await disconnect();

    expect(res.status).toBe(404);
  });
});
