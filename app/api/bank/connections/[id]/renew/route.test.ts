import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The renew route: who may start a renewal, whose connection it looks in, and that each refusal
 * reaches the screen as itself. What a renewal does is tested in lib/services/bank/consent.test.ts.
 */

const { access, renewMock } = vi.hoisted(() => ({ access: vi.fn(), renewMock: vi.fn() }));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: access,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/bank/consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/bank/consent")>()),
  startRenewal: renewMock,
}));

import { ConsentFlowError } from "@/lib/services/bank/consent";
import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";
import { POST } from "./route";

const renew = (params: Record<string, string> = { id: "conn-1" }) =>
  POST(
    new NextRequest("http://localhost:3000/api/bank/connections/conn-1/renew", { method: "POST" }),
    {
      params: Promise.resolve(params),
    },
  );

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
  renewMock.mockResolvedValue({ connectionId: "conn-1", url: "https://bank.example/authorise" });
});

describe("POST /api/bank/connections/[id]/renew", () => {
  it("refuses a caller who is not an owner before starting anything", async () => {
    access.mockResolvedValue(new Response(null, { status: 403 }));

    const res = await renew();

    expect(res.status).toBe(403);
    expect(renewMock).not.toHaveBeenCalled();
  });

  it("needs the connection's id", async () => {
    const res = await renew({});

    expect(res.status).toBe(400);
    expect(renewMock).not.toHaveBeenCalled();
  });

  it("answers the bank's address, looking only in the owner's own connections", async () => {
    // A manager acts on the owner's records: the scope is the owner, never the caller's own id.
    access.mockResolvedValue({ userId: "manager-1", scopeUserId: "owner-1" });

    const res = await renew();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { connectionId: "conn-1", url: "https://bank.example/authorise" },
    });
    expect(renewMock).toHaveBeenCalledWith("owner-1", "conn-1");
  });

  it("keeps the status of a consent-flow refusal", async () => {
    renewMock.mockRejectedValue(new ConsentFlowError("Bank provider unavailable", 503));

    const res = await renew();

    expect(res.status).toBe(503);
  });

  it("answers a connection that cannot be renewed as a 409 with its reason", async () => {
    renewMock.mockRejectedValue(
      new ConflictError("No bank to renew with", "bank_connection_renewal_unavailable"),
    );

    const res = await renew();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "bank_connection_renewal_unavailable" });
  });

  it("answers another owner's connection as not found", async () => {
    renewMock.mockRejectedValue(new ResourceNotFoundError("Bank connection"));

    const res = await renew();

    expect(res.status).toBe(404);
  });
});
