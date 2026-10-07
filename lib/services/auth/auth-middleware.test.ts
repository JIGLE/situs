import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import type { Session } from "next-auth";
import {
  getAccessContext,
  requireAdmin,
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

  /**
   * The Admin routes, the sign-up switches, the invitations and the accounts' roles among them,
   * answer an administrator and nobody else. A manager passes `isOwnerSessionRole` and every owner
   * route, so the line that keeps one out of Admin is this one. It reads the role the account holds
   * now, not the one its session signed in with: a demotion takes effect when it is made, and a
   * promotion does not wait for a new sign-in.
   */
  describe("requireAdmin", () => {
    const signedInAs = (tokenRole: string | undefined) =>
      mockGetServerSession({ user: { id: "user-1", role: tokenRole } } as unknown as Session);
    const stored = (role: string | null | Error) => {
      const findUnique =
        role instanceof Error
          ? vi.fn().mockRejectedValue(role)
          : vi.fn().mockResolvedValue(role === null ? null : { role });
      mockGetPrismaClient.mockReturnValue({ user: { findUnique } });
      return findUnique;
    };

    beforeEach(() => {
      mockGetPrismaClient.mockReset();
    });

    it("serves an administrator, with the id its session carries, after reading the stored role", async () => {
      await signedInAs("ADMIN");
      const findUnique = stored("ADMIN");

      const res = await requireAdmin({} as NextRequest);

      expect((res as { userId?: string }).userId).toBe("user-1");
      expect(findUnique).toHaveBeenCalledWith({ where: { id: "user-1" }, select: { role: true } });
    });

    it.each([
      ["a manager", "MANAGER"],
      ["a USER", "USER"],
    ])(
      "refuses %s with a 403 that says nothing more, whatever the session says",
      async (_who, role) => {
        await signedInAs("ADMIN");
        stored(role);

        const res = await requireAdmin({} as NextRequest);

        expect(res).toHaveProperty("status", 403);
        expect(await (res as Response).json()).toEqual({
          error: "Forbidden: Admin access required",
        });
        expect(res).not.toHaveProperty("userId");
      },
    );

    it("follows a promotion at once, without a new sign-in", async () => {
      await signedInAs("MANAGER");
      stored("ADMIN");

      const res = await requireAdmin({} as NextRequest);

      expect((res as { userId?: string }).userId).toBe("user-1");
    });

    it("follows a demotion at once, whatever role the session signed in with", async () => {
      await signedInAs("ADMIN");
      stored("MANAGER");

      expect(await requireAdmin({} as NextRequest)).toHaveProperty("status", 403);
    });

    it("refuses an account that no longer exists", async () => {
      await signedInAs("ADMIN");
      stored(null);

      expect(await requireAdmin({} as NextRequest)).toHaveProperty("status", 403);
    });

    it("refuses when the role cannot be read, and says so in the log", async () => {
      await signedInAs("ADMIN");
      stored(new Error("database is locked"));
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await requireAdmin({} as NextRequest)).toHaveProperty("status", 403);
      expect(log).toHaveBeenCalledWith(
        "requireAdmin: could not read the account's role:",
        "database is locked",
      );
      log.mockRestore();
    });

    it("trusts the session's role when the database cannot be read, for a route that says it must answer then", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await signedInAs("ADMIN");
        stored(new Error("database is locked"));
        expect(
          await requireAdmin({} as NextRequest, { sessionRoleIfDatabaseDown: true }),
        ).toHaveProperty("userId", "user-1");

        await signedInAs("MANAGER");
        stored(new Error("database is locked"));
        expect(
          await requireAdmin({} as NextRequest, { sessionRoleIfDatabaseDown: true }),
        ).toHaveProperty("status", 403);
      } finally {
        log.mockRestore();
      }
    });

    it("still refuses an account that is gone, for that route too, since then the database answered", async () => {
      await signedInAs("ADMIN");
      stored(null);

      expect(
        await requireAdmin({} as NextRequest, { sessionRoleIfDatabaseDown: true }),
      ).toHaveProperty("status", 403);
    });

    it("refuses an administrator who has not entered the second factor, as a 401, before reading anything", async () => {
      await mockGetServerSession({
        user: { id: "admin-1", role: "ADMIN" },
        mfaPending: true,
      } as unknown as Session);

      const res = await requireAdmin({} as NextRequest);

      expect(res).toHaveProperty("status", 401);
      expect(res).not.toHaveProperty("userId");
      expect(mockGetPrismaClient).not.toHaveBeenCalled();
    });

    it("refuses a request with no session as a 401", async () => {
      await mockGetServerSession(null);

      expect(await requireAdmin({} as NextRequest)).toHaveProperty("status", 401);
    });

    it("trusts the session's own role where there is no database to ask (a development sign-in)", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_DEV_AUTH", "true");
      try {
        await signedInAs("ADMIN");
        expect((await requireAdmin({} as NextRequest)) as { userId?: string }).toHaveProperty(
          "userId",
        );
        await signedInAs("MANAGER");
        expect(await requireAdmin({} as NextRequest)).toHaveProperty("status", 403);
        expect(mockGetPrismaClient).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
      }
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
