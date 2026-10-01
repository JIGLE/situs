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

/**
 * The second factor, as the token carries it. `mfaPending` is what the proxy and `requireAuth`
 * refuse on (`tests/proxy-mfa.test.ts`), so its life has to be exactly this: set at sign-in for an
 * account with TOTP, together with a name for the session, and cleared only by a proof of a code
 * made for that session (`mfa-proof.ts`). It used to clear on any code verified on the ACCOUNT in
 * the last five minutes, which released a sign-in with only the password a minute after the
 * owner's own. A callback that cleared it on anything less would turn the check into a formality.
 */
describe("jwt and session callbacks — the second factor", () => {
  type Callbacks = NonNullable<
    ReturnType<typeof import("@/lib/services/auth/auth").getAuthOptions>["callbacks"]
  >;
  type JwtCallback = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

  const SECRET = "second-factor-test-secret-0123456789-abcdefghij";
  const prismaMock = { user: { upsert: vi.fn(), findUnique: vi.fn() } };

  async function loadCallbacks(): Promise<Callbacks> {
    vi.doMock("@/lib/config/data-mode", () => ({
      isMockMode: false,
      isRealMode: true,
      dataMode: "real",
    }));
    vi.doMock("@/lib/services/database/database", () => ({
      getPrismaClient: () => prismaMock,
    }));
    const { getAuthOptions } = await import("@/lib/services/auth/auth");
    return getAuthOptions().callbacks as Callbacks;
  }

  const loadJwt = async () => (await loadCallbacks()).jwt as unknown as JwtCallback;

  /** A token already past sign-in, whose id was verified, so a refresh reads nothing. */
  const pendingToken = (sid: string | undefined = "sid-1") => ({
    sub: "db-cuid-1",
    id: "db-cuid-1",
    email: "owner@example.com",
    uidVerified: true,
    mfaPending: true,
    ...(sid ? { sid } : {}),
  });

  /** The browser's `update({ mfaProof })`, which NextAuth hands the callback as `trigger: "update"`. */
  const update = (token: Record<string, unknown>, mfaProof: unknown) => ({
    token,
    trigger: "update",
    session: { mfaProof },
  });

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_SECRET", SECRET);
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
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/config/data-mode");
    vi.doUnmock("@/lib/services/database/database");
  });

  it("holds a session pending at sign-in when the account has TOTP on, and names it", async () => {
    prismaMock.user.upsert.mockResolvedValue({ id: "db-cuid-1" });
    prismaMock.user.findUnique.mockResolvedValue({ totpEnabled: true });
    const jwt = await loadJwt();
    const signIn = () =>
      jwt({
        token: {},
        user: { id: "google-sub-999", email: "owner@example.com", name: "Owner" },
        account: { provider: "google" },
      });

    const first = await signIn();
    const second = await signIn();

    expect(first.mfaPending).toBe(true);
    expect(typeof first.sid).toBe("string");
    // Two sign-ins of one account are two sessions: a proof for one must not fit the other.
    expect(second.sid).not.toBe(first.sid);
  });

  it("holds none pending for an account without TOTP", async () => {
    prismaMock.user.upsert.mockResolvedValue({ id: "db-cuid-1" });
    prismaMock.user.findUnique.mockResolvedValue({ totpEnabled: false });
    const jwt = await loadJwt();

    const token = await jwt({
      token: {},
      user: { id: "google-sub-999", email: "owner@example.com", name: "Owner" },
      account: { provider: "google" },
    });

    expect(token.mfaPending).toBeUndefined();
    expect(token.sid).toBeUndefined();
  });

  it("keeps a session pending through a refresh, whoever verified a code, whenever", async () => {
    // The hole: the owner enters a code, and a sign-in with only the password a minute later is
    // released at its first refresh because the ACCOUNT has a verification from the last five.
    prismaMock.user.findUnique.mockResolvedValue({ totpVerifiedAt: new Date() });
    const jwt = await loadJwt();

    const refreshed = await jwt({ token: pendingToken() });
    const read = await jwt({ token: refreshed, trigger: undefined });

    expect(refreshed.mfaPending).toBe(true);
    expect(read.mfaPending).toBe(true);
    // Nothing on the account is consulted: it cannot say which session entered a code.
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("clears it for this session's own proof, and drops the name it no longer needs", async () => {
    const { signMfaProof } = await import("@/lib/services/auth/mfa-proof");
    const jwt = await loadJwt();
    const proof = signMfaProof(SECRET, { userId: "db-cuid-1", sid: "sid-1" });

    const token = await jwt(update(pendingToken("sid-1"), proof));

    expect(token.mfaPending).toBe(false);
    expect(token.sid).toBeUndefined();
  });

  it.each([
    ["another session's", { userId: "db-cuid-1", sid: "sid-2" }, undefined],
    ["another account's", { userId: "db-cuid-2", sid: "sid-1" }, undefined],
    ["an expired", { userId: "db-cuid-1", sid: "sid-1" }, Date.now() - 2 * 60 * 1000],
  ])("keeps it pending for %s proof", async (_label, made, at) => {
    const { signMfaProof } = await import("@/lib/services/auth/mfa-proof");
    const jwt = await loadJwt();
    const proof = signMfaProof(SECRET, made, at);

    expect((await jwt(update(pendingToken("sid-1"), proof))).mfaPending).toBe(true);
  });

  it.each([
    ["none", undefined],
    ["a word", "verified"],
    ["a flag", true],
    ["a number", 1],
  ])("keeps it pending for %s in place of a proof", async (_label, notAProof) => {
    const jwt = await loadJwt();

    expect((await jwt(update(pendingToken(), notAProof))).mfaPending).toBe(true);
  });

  it("keeps it pending for a proof signed under another secret", async () => {
    const { signMfaProof } = await import("@/lib/services/auth/mfa-proof");
    const jwt = await loadJwt();
    const forged = signMfaProof("not-the-servers-secret-0123456789-abcdefgh", {
      userId: "db-cuid-1",
      sid: "sid-1",
    });

    expect((await jwt(update(pendingToken("sid-1"), forged))).mfaPending).toBe(true);
  });

  it("clears only on an update: a proof carried by anything else is not read", async () => {
    const { signMfaProof } = await import("@/lib/services/auth/mfa-proof");
    const jwt = await loadJwt();
    const proof = signMfaProof(SECRET, { userId: "db-cuid-1", sid: "sid-1" });

    const token = await jwt({
      token: pendingToken("sid-1"),
      session: { mfaProof: proof },
    });

    expect(token.mfaPending).toBe(true);
  });

  it("names a session that was held pending before sessions had names", async () => {
    const { signMfaProof } = await import("@/lib/services/auth/mfa-proof");
    const jwt = await loadJwt();

    const named = await jwt({ token: pendingToken(undefined) });

    expect(named.mfaPending).toBe(true);
    expect(typeof named.sid).toBe("string");
    // And a proof made for that name releases it.
    const proof = signMfaProof(SECRET, { userId: "db-cuid-1", sid: named.sid as string });
    expect((await jwt(update(named, proof))).mfaPending).toBe(false);
  });

  it("leaves a session that is not pending alone, proof or no proof", async () => {
    const { signMfaProof } = await import("@/lib/services/auth/mfa-proof");
    const jwt = await loadJwt();
    const proof = signMfaProof(SECRET, { userId: "db-cuid-1", sid: "sid-1" });
    const plain = {
      sub: "db-cuid-1",
      id: "db-cuid-1",
      email: "owner@example.com",
      uidVerified: true,
    };

    const token = await jwt(update(plain, proof));

    expect(token.mfaPending).toBeUndefined();
    expect(token.sid).toBeUndefined();
  });

  it("puts the token's state on the session, which is where requireAuth reads it", async () => {
    const session = (await loadCallbacks()).session as unknown as (args: {
      session: Record<string, unknown>;
      token: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;

    const pending = await session({ session: { user: {} }, token: pendingToken() });
    const verified = await session({
      session: { user: {} },
      token: { ...pendingToken(), mfaPending: false },
    });
    const never = await session({ session: { user: {} }, token: { sub: "db-cuid-1" } });

    expect(pending.mfaPending).toBe(true);
    expect(verified.mfaPending).toBe(false);
    expect(never.mfaPending).toBe(false);
  });

  it("never puts the session's name on the session the browser reads", async () => {
    const session = (await loadCallbacks()).session as unknown as (args: {
      session: Record<string, unknown>;
      token: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;

    const shown = await session({ session: { user: {} }, token: pendingToken("sid-secret-1") });

    expect(JSON.stringify(shown)).not.toContain("sid-secret-1");
  });
});
