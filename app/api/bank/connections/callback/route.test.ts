import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Where the bank sends the owner back. The guards on the reference are tested in
 * lib/services/bank/consent.test.ts; this is where the owner lands afterwards.
 */

const { access, completeMock } = vi.hoisted(() => ({ access: vi.fn(), completeMock: vi.fn() }));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: access,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/bank/consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/bank/consent")>()),
  completeConsent: completeMock,
}));
vi.mock("@/lib/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { ConsentFlowError } from "@/lib/services/bank/consent";
import { GET } from "./route";

const back = (query = "?state=ref-1") =>
  GET(new NextRequest(`http://localhost:3000/api/bank/connections/callback${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
  completeMock.mockResolvedValue({ connectionId: "conn-1", isTest: false, renewal: false });
});

describe("GET /api/bank/connections/callback", () => {
  it("brings a renewal back to Settings saying it was renewed", async () => {
    completeMock.mockResolvedValue({ connectionId: "conn-1", isTest: false, renewal: true });

    const res = await back();

    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/settings?tab=integrations&bank=renewed");
  });

  it("brings a first consent back to Settings saying it connected", async () => {
    const res = await back();

    expect(res.headers.get("Location")).toBe("/settings?tab=integrations&bank=connected");
  });

  it("brings a test run back to Admin, where it is listed", async () => {
    completeMock.mockResolvedValue({ connectionId: "conn-1", isTest: true, renewal: false });

    const res = await back();

    expect(res.headers.get("Location")).toBe("/admin?bank=connected");
  });

  it("lands a failure on Settings without saying why", async () => {
    completeMock.mockRejectedValue(
      new ConsentFlowError("Unknown or expired consent reference", 404),
    );

    const res = await back();

    // The same for an unknown, a replayed and a foreign reference, so it cannot be an oracle.
    expect(res.headers.get("Location")).toBe("/settings?tab=integrations&bank=failed");
  });

  it("hands on everything the redirect carried, scoped to the owner", async () => {
    access.mockResolvedValue({ userId: "manager-1", scopeUserId: "owner-1" });

    await back("?state=ref-1&code=abc");

    expect(completeMock).toHaveBeenCalledWith("owner-1", "ref-1", { state: "ref-1", code: "abc" });
  });

  it("answers with a relative Location, never the server's own origin", async () => {
    for (const outcome of [
      { isTest: false, renewal: true },
      { isTest: false, renewal: false },
      { isTest: true, renewal: false },
    ]) {
      completeMock.mockResolvedValueOnce({ connectionId: "conn-1", ...outcome });
      const location = (await back()).headers.get("Location") ?? "";
      expect(location.startsWith("/")).toBe(true);
    }
  });

  it("refuses a caller who is not an owner before completing anything", async () => {
    access.mockResolvedValue(new Response(null, { status: 403 }));

    const res = await back();

    expect(res.status).toBe(403);
    expect(completeMock).not.toHaveBeenCalled();
  });
});
