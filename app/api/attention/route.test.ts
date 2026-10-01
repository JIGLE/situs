import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** The list of what a receipt still needs: who may read it, and whose it is. */

const { access, attentionMock } = vi.hoisted(() => ({ access: vi.fn(), attentionMock: vi.fn() }));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: access,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/attention/gather", () => ({ getAttention: attentionMock }));

import { GET } from "./route";

const read = () => GET(new NextRequest("http://localhost:3000/api/attention"));

const ATTENTION = {
  items: [{ id: "contract_number:lease-1", kind: "contract_number" }],
  counts: { total: 1, blocksReceipt: 1, reminders: 0, niceToHave: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
  attentionMock.mockResolvedValue(ATTENTION);
});

describe("GET /api/attention", () => {
  it("answers the items and their counts in the usual envelope", async () => {
    const res = await read();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: ATTENTION });
  });

  it("reads the list of the owner whose records the caller acts on", async () => {
    access.mockResolvedValue({ userId: "manager-1", scopeUserId: "owner-1" });

    await read();

    expect(attentionMock).toHaveBeenCalledWith("owner-1");
  });

  it("refuses a caller who is not an owner before reading anything", async () => {
    access.mockResolvedValue(new Response(null, { status: 403 }));

    expect((await read()).status).toBe(403);
    expect(attentionMock).not.toHaveBeenCalled();
  });

  it("refuses a missing session before reading anything", async () => {
    access.mockResolvedValue(new Response(null, { status: 401 }));

    expect((await read()).status).toBe(401);
    expect(attentionMock).not.toHaveBeenCalled();
  });
});
