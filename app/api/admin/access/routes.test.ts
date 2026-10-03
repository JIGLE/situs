import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Who may create an account: the two sign-up switches and the invitations, as Admin serves them.
 * Every handler is the administrator's only, answers a malformed body as a 400 and a refusal of the
 * service as itself (a 409 `account_exists`, a 404), and acts as the caller.
 */

const { auth, access, registration } = vi.hoisted(() => ({
  auth: { requireAdmin: vi.fn() },
  access: {
    getSignUpSettings: vi.fn(),
    listInvitations: vi.fn(),
    updateSignUpSettings: vi.fn(),
    createInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
  },
  registration: { allowedEmails: vi.fn() },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAdmin: auth.requireAdmin,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/auth/sign-up", () => access);
vi.mock("@/lib/services/auth/registration", () => registration);

import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";
import { GET } from "./route";
import { PUT } from "./settings/route";
import { POST } from "./invitations/route";
import { DELETE } from "./invitations/[id]/route";

const json = (method: string, body?: unknown, raw?: string) =>
  new NextRequest("http://localhost:3000/api/admin/access", {
    method,
    headers: { "Content-Type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const refusal = () =>
  NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireAdmin.mockResolvedValue({ userId: "admin-1", session: {} });
  registration.allowedEmails.mockReturnValue([]);
});

describe("GET /api/admin/access", () => {
  it("serves the switches, the invitations and the allowlist", async () => {
    access.getSignUpSettings.mockResolvedValue({ googleSignUp: false, invitations: true });
    access.listInvitations.mockResolvedValue([{ id: "inv-1", email: "g@example.org" }]);
    registration.allowedEmails.mockReturnValue(["partner@example.org"]);

    const res = await GET(json("GET"));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      settings: { googleSignUp: false, invitations: true },
      invitations: [{ id: "inv-1", email: "g@example.org" }],
      allowlist: ["partner@example.org"],
    });
  });

  it("answers the refusal and reads nothing for a caller who is not an administrator", async () => {
    auth.requireAdmin.mockResolvedValue(refusal());

    const res = await GET(json("GET"));

    expect(res.status).toBe(403);
    expect(access.getSignUpSettings).not.toHaveBeenCalled();
    expect(access.listInvitations).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/access/settings", () => {
  it("changes the switches as the caller and answers how they now stand", async () => {
    access.updateSignUpSettings.mockResolvedValue({ googleSignUp: true, invitations: true });

    const res = await PUT(json("PUT", { googleSignUp: true }));

    expect(res.status).toBe(200);
    expect(access.updateSignUpSettings).toHaveBeenCalledWith("admin-1", { googleSignUp: true });
    expect((await res.json()).data).toEqual({ googleSignUp: true, invitations: true });
  });

  it.each([
    ["nothing to change", {}],
    ["a switch that does not exist", { openToEveryone: true }],
    ["a switch that is not a boolean", { googleSignUp: "yes" }],
    ["a switch beside one that does not exist", { invitations: false, other: 1 }],
  ])("answers 400 for %s, and changes nothing", async (_name, body) => {
    const res = await PUT(json("PUT", body));

    expect(res.status).toBe(400);
    expect(access.updateSignUpSettings).not.toHaveBeenCalled();
  });

  it("answers 400, not 500, for a body that is not JSON", async () => {
    const res = await PUT(json("PUT", undefined, "{not json"));

    expect(res.status).toBe(400);
  });

  it("answers the refusal and changes nothing for a caller who is not an administrator", async () => {
    auth.requireAdmin.mockResolvedValue(refusal());

    const res = await PUT(json("PUT", { googleSignUp: true }));

    expect(res.status).toBe(403);
    expect(access.updateSignUpSettings).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/access/invitations", () => {
  it.each(["ADMIN", "MANAGER"] as const)(
    "invites an email as %s, as the caller, with the address lower-cased",
    async (role) => {
      access.createInvitation.mockResolvedValue({ id: "inv-1", email: "g@example.org", role });

      const res = await POST(json("POST", { email: "  G@Example.ORG ", role }));

      expect(res.status).toBe(201);
      expect(access.createInvitation).toHaveBeenCalledWith("admin-1", {
        email: "g@example.org",
        role,
      });
    },
  );

  it.each([
    ["no email", { role: "MANAGER" }],
    ["an email that is not one", { email: "not-an-email", role: "MANAGER" }],
    ["no role", { email: "g@example.org" }],
    ["a USER, which no owner route admits", { email: "g@example.org", role: "USER" }],
    ["a role that does not exist", { email: "g@example.org", role: "OWNER" }],
    ["an unknown field", { email: "g@example.org", role: "MANAGER", expiresAt: "2099-01-01" }],
  ])("answers 400 for %s, and invites nobody", async (_name, body) => {
    const res = await POST(json("POST", body));

    expect(res.status).toBe(400);
    expect(access.createInvitation).not.toHaveBeenCalled();
  });

  it("answers an email that already has an account as the 409 the service refused with", async () => {
    access.createInvitation.mockRejectedValue(
      new ConflictError("An account with this email already exists", "account_exists"),
    );

    const res = await POST(json("POST", { email: "member@example.org", role: "MANAGER" }));

    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("account_exists");
  });

  it("answers the refusal and invites nobody for a caller who is not an administrator", async () => {
    auth.requireAdmin.mockResolvedValue(refusal());

    const res = await POST(json("POST", { email: "g@example.org", role: "ADMIN" }));

    expect(res.status).toBe(403);
    expect(access.createInvitation).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/access/invitations/[id]", () => {
  it("withdraws the invitation as the caller", async () => {
    access.revokeInvitation.mockResolvedValue(undefined);

    const res = await DELETE(json("DELETE"), ctx({ id: "inv-1" }));

    expect(res.status).toBe(200);
    expect(access.revokeInvitation).toHaveBeenCalledWith("admin-1", "inv-1");
    expect((await res.json()).data).toEqual({ revoked: true });
  });

  it("answers 404 for an invitation that is not there", async () => {
    access.revokeInvitation.mockRejectedValue(new ResourceNotFoundError("Invitation"));

    const res = await DELETE(json("DELETE"), ctx({ id: "gone" }));

    expect(res.status).toBe(404);
  });

  it("answers 400 when the address names no invitation", async () => {
    const res = await DELETE(json("DELETE"), ctx({}));

    expect(res.status).toBe(400);
    expect(access.revokeInvitation).not.toHaveBeenCalled();
  });

  it("answers the refusal and withdraws nothing for a caller who is not an administrator", async () => {
    auth.requireAdmin.mockResolvedValue(refusal());

    const res = await DELETE(json("DELETE"), ctx({ id: "inv-1" }));

    expect(res.status).toBe(403);
    expect(access.revokeInvitation).not.toHaveBeenCalled();
  });
});
