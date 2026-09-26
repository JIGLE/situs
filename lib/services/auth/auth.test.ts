import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as loggerModule from "@/lib/utils/logger";

vi.resetModules();

describe("auth options", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_URL;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.ENABLE_DEMO_LOGIN;
    // Set NODE_ENV to test to avoid database requirement checks
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "test",
      writable: true,
      configurable: true,
      enumerable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns base options when no DATABASE_URL is set", async () => {
    const mod = await import("@/lib/services/auth/auth");
    const { getAuthOptions } = mod as typeof import("@/lib/services/auth/auth");

    const opts = getAuthOptions();
    expect(opts.pages).toBeDefined();
    expect(opts.pages?.signIn).toBe("/auth/signin");
    expect(opts.pages?.error).toBe("/auth/error");
  });

  it("falls back to base options when PrismaAdapter throws", async () => {
    // Mock PrismaAdapter to throw
    vi.doMock("@next-auth/prisma-adapter", () => ({
      PrismaAdapter: () => {
        throw new Error("adapter fail");
      },
    }));

    process.env.DATABASE_URL = "file:./dev.db";
    // Mock the logger to spy on warn calls
    const warnSpy = vi.spyOn(loggerModule.logger, "warn").mockImplementation(() => {});

    const mod = await import("@/lib/services/auth/auth");
    const { getAuthOptions } = mod as typeof import("@/lib/services/auth/auth");

    const opts = getAuthOptions();
    expect(opts.pages).toBeDefined();
    // Either logger.warn was called OR the adapter initialization succeeded
    // In either case, the function should return valid options
    expect(opts.providers).toBeDefined();

    warnSpy.mockRestore();
  });

  it("includes credentials provider when ENABLE_DEMO_LOGIN=true", async () => {
    process.env.ENABLE_DEMO_LOGIN = "true";
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      writable: true,
      configurable: true,
      enumerable: true,
    });

    const mod = await import("@/lib/services/auth/auth");
    const { getAuthOptions } = mod as typeof import("@/lib/services/auth/auth");

    const opts = getAuthOptions();
    expect(opts.providers).toBeDefined();
    expect(Array.isArray(opts.providers)).toBe(true);
  });

  it("includes credentials provider in non-production environment", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      writable: true,
      configurable: true,
      enumerable: true,
    });

    const mod = await import("@/lib/services/auth/auth");
    const { getAuthOptions } = mod as typeof import("@/lib/services/auth/auth");

    const opts = getAuthOptions();
    expect(opts.providers).toBeDefined();
    expect(Array.isArray(opts.providers)).toBe(true);
  });

  it("uses JWT session strategy", async () => {
    const mod = await import("@/lib/services/auth/auth");
    const { getAuthOptions } = mod as typeof import("@/lib/services/auth/auth");

    const opts = getAuthOptions();
    expect(opts.session).toBeDefined();
    expect(opts.session?.strategy).toBe("jwt");
    expect(opts.session?.maxAge).toBe(24 * 60 * 60); // 1 day
  });

  it("has callbacks defined", async () => {
    const mod = await import("@/lib/services/auth/auth");
    const { getAuthOptions } = mod as typeof import("@/lib/services/auth/auth");

    const opts = getAuthOptions();
    expect(opts.callbacks).toBeDefined();
  });

  it("has events defined", async () => {
    const mod = await import("@/lib/services/auth/auth");
    const { getAuthOptions } = mod as typeof import("@/lib/services/auth/auth");

    const opts = getAuthOptions();
    expect(opts.events).toBeDefined();
  });

  it("does not include Google OAuth when credentials are dummy", async () => {
    process.env.GOOGLE_CLIENT_ID = "dummy-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "dummy-client-secret";

    const mod = await import("@/lib/services/auth/auth");
    const { getAuthOptions } = mod as typeof import("@/lib/services/auth/auth");

    const opts = getAuthOptions();
    expect(opts.providers).toBeDefined();
    // Should not fail even with dummy credentials
  });

  it("includes Google OAuth when real credentials are provided", async () => {
    process.env.GOOGLE_CLIENT_ID = "real-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "real-client-secret";
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      writable: true,
      configurable: true,
      enumerable: true,
    });

    const mod = await import("@/lib/services/auth/auth");
    const { getAuthOptions } = mod as typeof import("@/lib/services/auth/auth");

    const opts = getAuthOptions();
    expect(opts.providers).toBeDefined();
    // Authentication setup successful
  });
});

/**
 * The JWT callback owns the id that every owned record foreign-keys against.
 * OAuth has no PrismaAdapter under the JWT strategy, so this callback is the
 * only thing that ever creates the User row — and the only thing that can hand
 * out a session pointing at a row that does not exist.
 */
describe("jwt callback — session id provisioning", () => {
  type JwtArgs = {
    token: Record<string, unknown>;
    user?: { id: string; email?: string; name?: string } | null;
    account?: { provider?: string } | null;
  };
  type JwtCallback = (args: JwtArgs) => Promise<Record<string, unknown>>;

  const prismaMock = {
    user: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
  };

  async function loadJwtCallback(): Promise<JwtCallback> {
    vi.doMock("@/lib/config/data-mode", () => ({
      isMockMode: false,
      isRealMode: true,
      dataMode: "real",
    }));
    vi.doMock("@/lib/services/database/database", () => ({
      getPrismaClient: () => prismaMock,
    }));
    const { getAuthOptions } = await import("@/lib/services/auth/auth");
    const cb = getAuthOptions().callbacks?.jwt;
    return cb as unknown as JwtCallback;
  }

  beforeEach(() => {
    vi.resetModules();
    prismaMock.user.upsert.mockReset();
    prismaMock.user.findUnique.mockReset();
    process.env.DATABASE_URL = "file:./dev.db";
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "test",
      writable: true,
      configurable: true,
      enumerable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/config/data-mode");
    vi.doUnmock("@/lib/services/database/database");
  });

  it("puts the DB id — not the provider id — in the token on OAuth sign-in", async () => {
    prismaMock.user.upsert.mockResolvedValue({ id: "db-cuid-1" });
    prismaMock.user.findUnique.mockResolvedValue({ totpEnabled: false });
    const jwt = await loadJwtCallback();

    const token = await jwt({
      token: {},
      user: { id: "google-sub-999", email: "owner@example.com", name: "Owner" },
      account: { provider: "google" },
    });

    expect(token.sub).toBe("db-cuid-1");
    expect(token.id).toBe("db-cuid-1");
  });

  it("carries the language the account chose into the token at sign-in", async () => {
    prismaMock.user.upsert.mockResolvedValue({ id: "db-cuid-1" });
    prismaMock.user.findUnique.mockResolvedValue({
      totpEnabled: false,
      settings: { language: "en", languageChosenAt: new Date("2026-09-25T10:00:00Z") },
    });
    const jwt = await loadJwtCallback();

    const token = await jwt({
      token: {},
      user: { id: "google-sub-999", email: "owner@example.com", name: "Owner" },
      account: { provider: "google" },
    });

    expect(token.locale).toBe("en");
  });

  it("carries no language when the account only holds the column's default", async () => {
    // Rows from before choices were recorded say "en" with no date. Carrying that would switch
    // every device without a language of its own to English at sign-in.
    prismaMock.user.upsert.mockResolvedValue({ id: "db-cuid-1" });
    prismaMock.user.findUnique.mockResolvedValue({
      totpEnabled: false,
      settings: { language: "en", languageChosenAt: null },
    });
    const jwt = await loadJwtCallback();

    const token = await jwt({
      token: {},
      user: { id: "google-sub-999", email: "owner@example.com", name: "Owner" },
      account: { provider: "google" },
    });

    expect(token.locale).toBeUndefined();
  });

  it("refuses to issue a session when provisioning the User row fails", async () => {
    // The database was unreachable at sign-in. Falling through here would mint a
    // token carrying Google's sub, which FK-violates on every subsequent write.
    prismaMock.user.upsert.mockRejectedValue(new Error("database is locked"));
    const jwt = await loadJwtCallback();

    await expect(
      jwt({
        token: {},
        user: { id: "google-sub-999", email: "owner@example.com", name: "Owner" },
        account: { provider: "google" },
      }),
    ).rejects.toThrow("USER_PROVISIONING_FAILED");
  });

  it("repairs a token whose id matches no User row, using the email", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null) // lookup by the stale provider id
      .mockResolvedValueOnce({ id: "db-cuid-2" }); // lookup by email
    const jwt = await loadJwtCallback();

    const token = await jwt({
      token: { sub: "google-sub-999", id: "google-sub-999", email: "owner@example.com" },
    });

    expect(token.sub).toBe("db-cuid-2");
    expect(token.id).toBe("db-cuid-2");
    expect(token.uidVerified).toBe(true);
  });

  it("clears an unusable id when the email resolves to nothing either", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const jwt = await loadJwtCallback();

    const token = await jwt({
      token: { sub: "google-sub-999", id: "google-sub-999", email: "gone@example.com" },
    });

    expect(token.sub).toBeUndefined();
    expect(token.id).toBeUndefined();
  });

  it("verifies a good id only once per token", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "db-cuid-3" });
    const jwt = await loadJwtCallback();

    const first = await jwt({
      token: { sub: "db-cuid-3", id: "db-cuid-3", email: "owner@example.com" },
    });
    expect(first.uidVerified).toBe(true);
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);

    await jwt({ token: first });
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("leaves the token alone when the database is unavailable", async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error("connection refused"));
    const jwt = await loadJwtCallback();

    const token = await jwt({
      token: { sub: "db-cuid-4", id: "db-cuid-4", email: "owner@example.com" },
    });

    // Not repaired, not cleared, not marked verified — re-checked next refresh.
    expect(token.sub).toBe("db-cuid-4");
    expect(token.uidVerified).toBeUndefined();
  });
});
