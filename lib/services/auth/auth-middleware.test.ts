import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import type { Session } from "next-auth";
import {
  getAccessContext,
  requireAuth,
  requireOwnership,
} from "@/lib/services/auth/auth-middleware";
import { NextRequest } from "next/server";

// Set DATABASE_URL before any imports that might check it
beforeAll(() => {
  process.env.DATABASE_URL = "file:./test.db";
});

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

const { mockGetPrismaClient } = vi.hoisted(() => ({
  mockGetPrismaClient: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: mockGetPrismaClient,
}));

import { mockGetServerSession, resetGetServerSession } from "@/tests/helpers/next-auth";

describe("auth-middleware", () => {
  afterEach(async () => {
    await resetGetServerSession();
  });

  it("returns NextResponse when no session", async () => {
    await mockGetServerSession(null);

    const res = await requireAuth({} as NextRequest);
    expect(res).toHaveProperty("status", 401);
  });

  it("returns session and userId when session present", async () => {
    await mockGetServerSession({ user: { id: "user-1" } } as Session);

    const res = await requireAuth({} as NextRequest);
    expect((res as { userId?: string }).userId).toBe("user-1");
  });

  it("uses session user id without db lookup when both id and email exist", async () => {
    await mockGetServerSession({ user: { id: "user-1", email: "u@example.com" } } as Session);

    const res = await requireAuth({} as NextRequest);

    expect((res as { userId?: string }).userId).toBe("user-1");
    expect(mockGetPrismaClient).not.toHaveBeenCalled();
  });

  /**
   * `mfaPending` is set at sign-in for an account with TOTP, until its code is verified. The
   * proxy refuses such a session first; this is the same refusal for a handler reached some other
   * way. Before it, the second factor was a redirect and nothing more.
   */
  describe("a session still waiting for its second factor", () => {
    it("is refused with a 401 that names why, and no user id", async () => {
      await mockGetServerSession({
        user: { id: "user-1", email: "u@example.com" },
        mfaPending: true,
      } as unknown as Session);

      const res = await requireAuth({} as NextRequest);

      expect(res).toHaveProperty("status", 401);
      expect(await (res as Response).json()).toEqual({
        error: "Two-factor verification required",
        reason: "mfa_required",
      });
      expect(res).not.toHaveProperty("userId");
    });

    it("is served once its code is verified", async () => {
      await mockGetServerSession({
        user: { id: "user-1" },
        mfaPending: false,
      } as unknown as Session);

      const res = await requireAuth({} as NextRequest);

      expect((res as { userId?: string }).userId).toBe("user-1");
    });

    it("is refused by the owner check and the ownership check, which both start here", async () => {
      await mockGetServerSession({
        user: { id: "user-1", role: "ADMIN" },
        mfaPending: true,
      } as unknown as Session);

      expect(await getAccessContext({} as NextRequest)).toHaveProperty("status", 401);
      expect(await requireOwnership({} as NextRequest, "user-1")).toHaveProperty("status", 401);
    });
  });

  it("requireOwnership denies access when userId mismatch", async () => {
    await mockGetServerSession({ user: { id: "user-1" } } as Session);

    const res = await requireOwnership({} as NextRequest, "other");
    expect(res).toHaveProperty("status", 403);
  });

  it("requireOwnership allows when userId matches", async () => {
    await mockGetServerSession({ user: { id: "user-1" } } as Session);

    const res = await requireOwnership({} as NextRequest, "user-1");
    expect(res).toBeUndefined();
  });
});
