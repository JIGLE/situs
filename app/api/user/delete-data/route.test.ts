import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * The signed-in account deletes itself. Which account is the session's alone, no input chooses it;
 * the only administrator is refused while others remain (a 409 `last_admin`); nothing the service
 * threw reaches the client but its status and, for a refusal, its reason.
 */

const { auth, accounts, audit } = vi.hoisted(() => ({
  auth: { requireAuth: vi.fn() },
  accounts: { deleteOwnAccount: vi.fn() },
  audit: { logAudit: vi.fn() },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({ requireAuth: auth.requireAuth }));
vi.mock("@/lib/services/auth/accounts", () => accounts);
vi.mock("@/lib/services/audit-log", () => audit);

import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";
import { POST } from "./route";

const post = (url = "http://localhost:3000/api/user/delete-data", body?: unknown) =>
  new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  auth.requireAuth.mockResolvedValue({
    userId: "user-1",
    session: { user: { id: "user-1", email: "owner@example.org" } },
  });
});

describe("POST /api/user/delete-data", () => {
  it("deletes the signed-in account and says so", async () => {
    accounts.deleteOwnAccount.mockResolvedValue(undefined);

    const res = await POST(post());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Data deleted successfully" });
    expect(accounts.deleteOwnAccount).toHaveBeenCalledWith("user-1");
  });

  it("deletes the account the session names, whatever the request asks for", async () => {
    accounts.deleteOwnAccount.mockResolvedValue(undefined);

    await POST(
      post("http://localhost:3000/api/user/delete-data?id=victim&userId=victim", {
        id: "victim",
        userId: "victim",
      }),
    );

    expect(accounts.deleteOwnAccount).toHaveBeenCalledTimes(1);
    expect(accounts.deleteOwnAccount).toHaveBeenCalledWith("user-1");
  });

  it("writes no audit entry, whether it deletes or refuses", async () => {
    // One written first would go with the account in the same cascade and record nothing, and after
    // a refusal it would stay and say a deletion happened.
    accounts.deleteOwnAccount.mockResolvedValueOnce(undefined);
    await POST(post());
    accounts.deleteOwnAccount.mockRejectedValueOnce(
      new ConflictError("The instance needs an administrator", "last_admin"),
    );
    await POST(post());

    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  it("answers the refusal and deletes nothing for a caller who is not signed in", async () => {
    auth.requireAuth.mockResolvedValue(
      NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    );

    const res = await POST(post());

    expect(res.status).toBe(401);
    expect(accounts.deleteOwnAccount).not.toHaveBeenCalled();
  });

  it("answers the only administrator's deletion as the 409 last_admin the service refused with", async () => {
    accounts.deleteOwnAccount.mockRejectedValue(
      new ConflictError("The instance needs an administrator", "last_admin"),
    );

    const res = await POST(post());

    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("last_admin");
  });

  it("answers 404 for an account that is already gone", async () => {
    accounts.deleteOwnAccount.mockRejectedValue(new ResourceNotFoundError("Account"));

    const res = await POST(post());

    expect(res.status).toBe(404);
  });

  it("answers 500 without the detail when something unexpected fails", async () => {
    accounts.deleteOwnAccount.mockRejectedValue(new Error("SQLITE_BUSY: secret detail"));

    const res = await POST(post());

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
