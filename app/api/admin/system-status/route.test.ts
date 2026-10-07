import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * The diagnostics route answers an administrator even when the database cannot say who that is: it is
 * opened precisely when the app is broken. Every other Admin route refuses in that case.
 */

const { auth, status } = vi.hoisted(() => ({
  auth: { requireAdmin: vi.fn() },
  status: { getSystemStatus: vi.fn() },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAdmin: auth.requireAdmin,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/admin/system-status", () => status);

import { GET } from "./route";

const request = () => new NextRequest("http://localhost:3000/api/admin/system-status");

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireAdmin.mockResolvedValue({ userId: "admin-1", session: {} });
  status.getSystemStatus.mockResolvedValue({ checks: [] });
});

describe("GET /api/admin/system-status", () => {
  it("asks for the administrator on the session's word when the database cannot be read", async () => {
    const req = request();

    await GET(req);

    expect(auth.requireAdmin).toHaveBeenCalledWith(req, { sessionRoleIfDatabaseDown: true });
  });

  it("answers the status for the administrator it was given", async () => {
    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(status.getSystemStatus).toHaveBeenCalledWith("admin-1");
    expect((await res.json()).data).toEqual({ checks: [] });
  });

  it("answers the refusal, and reads nothing, for a caller who is not an administrator", async () => {
    auth.requireAdmin.mockResolvedValue(
      NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 }),
    );

    const res = await GET(request());

    expect(res.status).toBe(403);
    expect(status.getSystemStatus).not.toHaveBeenCalled();
  });
});
