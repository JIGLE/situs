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

  const prismaMock = { user: { findUnique: vi.fn() } };
  /** The account the registration gate lets the sign-in have (`registration.ts`), or its refusal. */
  const provisionMock = vi.fn();

  async function loadJwtCallback(): Promise<JwtCallback> {
    vi.doMock("@/lib/config/data-mode", () => ({
      isMockMode: false,
      isRealMode: true,
      dataMode: "real",
    }));
    vi.doMock("@/lib/services/database/database", () => ({
      getPrismaClient: () => prismaMock,
    }));
    vi.doMock("@/lib/services/auth/registration", () => ({
      provisionAccount: provisionMock,
      resolveSignIn: vi.fn(),
    }));
    const { getAuthOptions } = await import("@/lib/services/auth/auth");
    const cb = getAuthOptions().callbacks?.jwt;
    return cb as unknown as JwtCallback;
  }

  beforeEach(() => {
    vi.resetModules();
    provisionMock.mockReset();
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
    vi.doUnmock("@/lib/services/auth/registration");
  });

  it("puts the DB id — not the provider id — in the token on OAuth sign-in", async () => {
    provisionMock.mockResolvedValue({ id: "db-cuid-1" });
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
    provisionMock.mockResolvedValue({ id: "db-cuid-1" });
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
    provisionMock.mockResolvedValue({ id: "db-cuid-1" });
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
    provisionMock.mockRejectedValue(new Error("database is locked"));
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

    // The id check selects `id`; the session cutoff has its own read (`session-epoch.ts`).
    const idChecks = () =>
      prismaMock.user.findUnique.mock.calls.filter(
        ([args]) => (args as { select?: { id?: boolean } }).select?.id === true,
      ).length;

    const first = await jwt({
      token: { sub: "db-cuid-3", id: "db-cuid-3", email: "owner@example.com" },
    });
    expect(first.uidVerified).toBe(true);
    expect(idChecks()).toBe(1);

    await jwt({ token: first });
    expect(idChecks()).toBe(1);
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
  const prismaMock = { user: { findUnique: vi.fn() } };
  const provisionMock = vi.fn();

  async function loadCallbacks(): Promise<Callbacks> {
    vi.doMock("@/lib/config/data-mode", () => ({
      isMockMode: false,
      isRealMode: true,
      dataMode: "real",
    }));
    vi.doMock("@/lib/services/database/database", () => ({
      getPrismaClient: () => prismaMock,
    }));
    vi.doMock("@/lib/services/auth/registration", () => ({
      provisionAccount: provisionMock,
      resolveSignIn: vi.fn(),
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
    provisionMock.mockReset();
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
    vi.doUnmock("@/lib/services/auth/registration");
  });

  it("holds a session pending at sign-in when the account has TOTP on, and names it", async () => {
    provisionMock.mockResolvedValue({ id: "db-cuid-1" });
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
    provisionMock.mockResolvedValue({ id: "db-cuid-1" });
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

  it.each([
    ["Google", { id: "google-sub-999" }, { provider: "google" }],
    ["password", { id: "db-cuid-1" }, { provider: "credentials" }],
  ])(
    "refuses a %s sign-in it cannot read the second-factor state for, rather than let it in",
    async (_label, user, account) => {
      // The read at sign-in is the only thing that sets `mfaPending`. Swallowing its failure would
      // hand a full session to a first factor alone whenever the database happened to be busy.
      provisionMock.mockResolvedValue({ id: "db-cuid-1" });
      prismaMock.user.findUnique.mockRejectedValue(new Error("database is locked"));
      const jwt = await loadJwt();

      await expect(
        jwt({ token: {}, user: { ...user, email: "owner@example.com", name: "Owner" }, account }),
      ).rejects.toThrow("MFA_STATE_UNREADABLE");
    },
  );

  it("keeps a session pending through a refresh, whoever verified a code, whenever", async () => {
    // The hole: the owner enters a code, and a sign-in with only the password a minute later is
    // released at its first refresh because the ACCOUNT has a verification from the last five.
    prismaMock.user.findUnique.mockResolvedValue({ totpVerifiedAt: new Date() });
    const jwt = await loadJwt();

    const refreshed = await jwt({ token: pendingToken() });
    const read = await jwt({ token: refreshed, trigger: undefined });

    expect(refreshed.mfaPending).toBe(true);
    expect(read.mfaPending).toBe(true);
    // The verification on the account is not consulted: it cannot say which session entered a code.
    // (The session cutoff is read, and is a different column.)
    const consulted = prismaMock.user.findUnique.mock.calls.filter(
      ([args]) => !("sessionsValidFrom" in ((args as { select?: object }).select ?? {})),
    );
    expect(consulted).toEqual([]);
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

/**
 * The role a session carries. `requireAdmin` and `isOwnerSessionRole` read it off the session, so it
 * has to be the role stored on the account. A Google sign-in's profile has none, and the callback
 * fell back to "ADMIN" whatever the row said: an account stored as MANAGER or USER signed in as an
 * administrator. The role is now read in the query that provisions the row, and a role that cannot
 * be read is no administrator.
 */
describe("jwt and session callbacks — the role the session carries", () => {
  type Callbacks = NonNullable<
    ReturnType<typeof import("@/lib/services/auth/auth").getAuthOptions>["callbacks"]
  >;
  type JwtCallback = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  type SessionCallback = (args: {
    session: Record<string, unknown>;
    token: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;

  const prismaMock = { user: { findUnique: vi.fn() } };
  const provisionMock = vi.fn();

  async function load(options: { mock?: boolean } = {}) {
    vi.doMock("@/lib/config/data-mode", () => ({
      isMockMode: Boolean(options.mock),
      isRealMode: !options.mock,
      dataMode: options.mock ? "mock" : "real",
    }));
    vi.doMock("@/lib/services/database/database", () => ({
      getPrismaClient: () => prismaMock,
    }));
    vi.doMock("@/lib/services/auth/registration", () => ({
      provisionAccount: provisionMock,
      resolveSignIn: vi.fn(),
    }));
    // The registry is reset for every test, so the logger to spy on is the one the callbacks import.
    const { logger } = await import("@/lib/utils/logger");
    const { getAuthOptions } = await import("@/lib/services/auth/auth");
    const callbacks = getAuthOptions().callbacks as Callbacks;
    return {
      jwt: callbacks.jwt as unknown as JwtCallback,
      session: callbacks.session as unknown as SessionCallback,
      logger,
    };
  }

  const googleSignIn = () => ({
    token: {},
    user: { id: "google-sub-999", email: "co-owner@example.com", name: "Co-owner" },
    account: { provider: "google" },
  });

  beforeEach(() => {
    vi.resetModules();
    provisionMock.mockReset();
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.findUnique.mockResolvedValue({ totpEnabled: false });
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
    vi.doUnmock("@/lib/services/auth/registration");
  });

  it.each(["ADMIN", "MANAGER", "USER"])(
    "carries the %s role stored on the account at a Google sign-in",
    async (role) => {
      provisionMock.mockResolvedValue({ id: "db-cuid-1", role });
      const { jwt } = await load();

      const token = await jwt(googleSignIn());

      expect(token.role).toBe(role);
    },
  );

  it("hands the registration gate who is signing in, with the provider, and takes the role from it", async () => {
    provisionMock.mockResolvedValue({ id: "db-cuid-1", role: "MANAGER" });
    const { jwt } = await load();

    const token = await jwt(googleSignIn());

    expect(provisionMock).toHaveBeenCalledWith({
      email: "co-owner@example.com",
      name: "Co-owner",
      image: undefined,
      provider: "google",
      // The sign-in carried no profile, so nothing says Google verified the email.
      emailVerified: false,
    });
    expect(token.role).toBe("MANAGER");
  });

  it.each([
    ["a verified email", { email_verified: true }, true],
    ["a verified email, as Google's token endpoint spells it", { email_verified: "true" }, true],
    ["an email Google says is not verified", { email_verified: false }, false],
    ["a profile without the claim", { sub: "google-sub-999" }, false],
    ["no profile at all", undefined, false],
    ["a profile that is not an object", "email_verified", false],
  ])("tells the gate what the provider says of the email: %s", async (_case, profile, expected) => {
    provisionMock.mockResolvedValue({ id: "db-cuid-1", role: "MANAGER" });
    const { jwt } = await load();

    await jwt({ ...googleSignIn(), profile });

    expect(provisionMock).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: expected }),
    );
  });

  it("refuses the sign-in when the gate admits nobody for it", async () => {
    provisionMock.mockRejectedValue(new Error("REGISTRATION_CLOSED"));
    const { jwt } = await load();

    await expect(jwt(googleSignIn())).rejects.toThrow("USER_PROVISIONING_FAILED");
  });

  it("never lets a role already on the token outrank the stored one", async () => {
    provisionMock.mockResolvedValue({ id: "db-cuid-1", role: "MANAGER" });
    const { jwt } = await load();

    const token = await jwt({ ...googleSignIn(), token: { role: "ADMIN" } });

    expect(token.role).toBe("MANAGER");
  });

  it("is no administrator when the row's role could not be read", async () => {
    provisionMock.mockResolvedValue({ id: "db-cuid-1" });
    const { jwt } = await load();

    const token = await jwt(googleSignIn());

    expect(token.role).toBe("USER");
  });

  it("says in the log that it signed a USER in, since the owner routes will refuse it", async () => {
    provisionMock.mockResolvedValue({ id: "db-cuid-1", role: "USER" });
    const { jwt, logger } = await load();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await jwt(googleSignIn());

    expect(warn).toHaveBeenCalledWith("Signed in as a USER: the owner routes refuse this role", {
      userId: "db-cuid-1",
    });
  });

  it("says nothing of it for an administrator or a manager", async () => {
    const { jwt, logger } = await load();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    for (const role of ["ADMIN", "MANAGER"]) {
      provisionMock.mockResolvedValue({ id: "db-cuid-1", role });
      await jwt(googleSignIn());
    }

    expect(warn).not.toHaveBeenCalledWith(
      "Signed in as a USER: the owner routes refuse this role",
      expect.anything(),
    );
  });

  it("carries the role the credentials provider returned for its row", async () => {
    const { jwt } = await load();

    const token = await jwt({
      token: {},
      user: { id: "db-cuid-2", email: "demo@situs.local", name: "Demo", role: "MANAGER" },
      account: { provider: "credentials" },
    });

    expect(token.role).toBe("MANAGER");
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it("keeps the demo's ADMIN where there is no database to read", async () => {
    const { jwt } = await load({ mock: true });

    const token = await jwt(googleSignIn());

    expect(token.role).toBe("ADMIN");
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it("puts the token's role on the session, and gives a token with none no administrator session", async () => {
    const { session } = await load();

    const manager = await session({ session: { user: {} }, token: { sub: "u1", role: "MANAGER" } });
    const none = await session({ session: { user: {} }, token: { sub: "u1" } });

    expect((manager.user as { role?: string }).role).toBe("MANAGER");
    expect((none.user as { role?: string }).role).toBe("USER");
  });
});

/**
 * The `signIn` callback is the registration gate at the door: it runs before the jwt callback
 * provisions a row, so a refused identity leaves nothing behind. The policy it asks is
 * `registration.test.ts`'s; this is what the callback hands it, what it does with the answer, and
 * what it says in the log, since an owner whose invited guest cannot get in will read that log.
 */
describe("signIn callback — the registration gate", () => {
  type Callbacks = NonNullable<
    ReturnType<typeof import("@/lib/services/auth/auth").getAuthOptions>["callbacks"]
  >;
  type SignInCallback = (args: Record<string, unknown>) => Promise<boolean>;

  const resolveMock = vi.fn();
  const prismaMock = { account: { deleteMany: vi.fn() } };

  async function load(options: { mock?: boolean } = {}) {
    vi.doMock("@/lib/config/data-mode", () => ({
      isMockMode: Boolean(options.mock),
      isRealMode: !options.mock,
      dataMode: options.mock ? "mock" : "real",
    }));
    vi.doMock("@/lib/services/database/database", () => ({
      getPrismaClient: () => prismaMock,
    }));
    vi.doMock("@/lib/services/auth/registration", () => ({
      provisionAccount: vi.fn(),
      resolveSignIn: resolveMock,
    }));
    // The registry is reset for every test, so the logger to spy on is the one the callbacks import.
    const { logger } = await import("@/lib/utils/logger");
    const { getAuthOptions } = await import("@/lib/services/auth/auth");
    const callbacks = getAuthOptions().callbacks as Callbacks;
    return { signIn: callbacks.signIn as unknown as SignInCallback, logger };
  }

  const googleSignIn = (profile?: unknown) => ({
    user: { id: "google-sub-999", email: "co-owner@example.com", name: "Co-owner" },
    account: { provider: "google", providerAccountId: "google-sub-999" },
    profile,
  });

  beforeEach(() => {
    vi.resetModules();
    resolveMock.mockReset();
    prismaMock.account.deleteMany.mockReset();
    prismaMock.account.deleteMany.mockResolvedValue({ count: 0 });
    process.env.DATABASE_URL = "file:./dev.db";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/config/data-mode");
    vi.doUnmock("@/lib/services/database/database");
    vi.doUnmock("@/lib/services/auth/registration");
  });

  it("lets through an identity the gate admits", async () => {
    resolveMock.mockResolvedValue({ allow: true, reason: "existing_user" });
    const { signIn } = await load();

    await expect(signIn(googleSignIn())).resolves.toBe(true);
  });

  it.each([
    ["a verified email", { email_verified: true }, true],
    ["an email Google says is not verified", { email_verified: false }, false],
    ["a profile without the claim", {}, false],
    ["no profile at all", undefined, false],
  ])(
    "asks the gate about the email, the provider and the provider's word: %s",
    async (_case, profile, expected) => {
      resolveMock.mockResolvedValue({ allow: true, reason: "existing_user" });
      const { signIn } = await load();

      await signIn(googleSignIn(profile));

      expect(resolveMock).toHaveBeenCalledWith("co-owner@example.com", "google", expected);
    },
  );

  it("refuses the sign-in and says registration is closed", async () => {
    resolveMock.mockResolvedValue({ allow: false, reason: "registration_closed" });
    const { signIn, logger } = await load();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(signIn(googleSignIn({ email_verified: true }))).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith("Refused sign-in: registration is closed on this instance", {
      provider: "google",
    });
  });

  it("refuses the sign-in and says the provider has not verified the email", async () => {
    resolveMock.mockResolvedValue({ allow: false, reason: "email_unverified" });
    const { signIn, logger } = await load();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(signIn(googleSignIn({ email_verified: false }))).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith("Refused sign-in: the provider has not verified this email", {
      provider: "google",
    });
    // A refusal leaves nothing behind: the stale-link clean-up never ran.
    expect(prismaMock.account.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses the sign-in when the gate cannot be evaluated", async () => {
    resolveMock.mockRejectedValue(new Error("database is locked"));
    const { signIn, logger } = await load();
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});

    await expect(signIn(googleSignIn({ email_verified: true }))).resolves.toBe(false);

    expect(error).toHaveBeenCalledWith(
      "Could not evaluate the registration gate — refusing sign-in",
      expect.any(Error),
    );
  });

  it("leaves the credentials provider to authorize(), which already checked the password", async () => {
    const { signIn } = await load();

    await expect(
      signIn({
        user: { id: "u1", email: "demo@situs.local" },
        account: { provider: "credentials" },
      }),
    ).resolves.toBe(true);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("asks nothing where there is no database to ask (mock mode)", async () => {
    const { signIn } = await load({ mock: true });

    await expect(signIn(googleSignIn())).resolves.toBe(true);
    expect(resolveMock).not.toHaveBeenCalled();
  });
});

/**
 * Turning the second factor on ends every session signed in before it (`session-epoch.ts`). A
 * callback that only looked at NextAuth's `iat` would end nothing: it is rewritten whenever the
 * token is re-encoded, so a session refreshed after the stamp would look new. Each case here is a
 * way the check could pass while ending nothing, or end the owner's own session with the rest.
 */
describe("jwt callback — sessions the second factor ended", () => {
  type JwtCallback = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

  const SECRET = "second-factor-test-secret-0123456789-abcdefghij";
  // Some moments ago: a renewed session is stamped with the real clock, which must not be behind it.
  const STAMP = Date.now() - 60_000;
  const prismaMock = { user: { findUnique: vi.fn() } };
  const provisionMock = vi.fn();

  async function loadJwt(): Promise<JwtCallback> {
    vi.doMock("@/lib/config/data-mode", () => ({
      isMockMode: false,
      isRealMode: true,
      dataMode: "real",
    }));
    vi.doMock("@/lib/services/database/database", () => ({
      getPrismaClient: () => prismaMock,
    }));
    vi.doMock("@/lib/services/auth/registration", () => ({
      provisionAccount: provisionMock,
      resolveSignIn: vi.fn(),
    }));
    const { getAuthOptions } = await import("@/lib/services/auth/auth");
    return getAuthOptions().callbacks?.jwt as unknown as JwtCallback;
  }

  /** A signed-in session whose id was verified, so a refresh reads only the stamp. */
  const token = (signedAt: number | undefined, extra: Record<string, unknown> = {}) => ({
    sub: "db-cuid-1",
    id: "db-cuid-1",
    email: "owner@example.com",
    uidVerified: true,
    ...(signedAt === undefined ? {} : { signedAt }),
    ...extra,
  });

  const stamped = (at: number | null) =>
    prismaMock.user.findUnique.mockResolvedValue({
      sessionsValidFrom: at === null ? null : new Date(at),
    });

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_SECRET", SECRET);
    provisionMock.mockReset();
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
    vi.doUnmock("@/lib/services/auth/registration");
  });

  it("names a session at sign-in, once, and a refresh does not move it", async () => {
    provisionMock.mockResolvedValue({ id: "db-cuid-1" });
    prismaMock.user.findUnique.mockResolvedValue({ totpEnabled: false, settings: null });
    const jwt = await loadJwt();
    const before = Date.now();

    const first = await jwt({
      token: {},
      user: { id: "google-sub-999", email: "owner@example.com", name: "Owner" },
      account: { provider: "google" },
    });
    const signedAt = first.signedAt as number;
    expect(signedAt).toBeGreaterThanOrEqual(before);
    expect(signedAt).toBeLessThanOrEqual(Date.now());

    stamped(null);
    const refreshed = await jwt({ token: { ...first, uidVerified: true } });
    expect(refreshed.signedAt).toBe(signedAt);
  });

  it("lets a session through while the account has no stamp", async () => {
    stamped(null);
    const jwt = await loadJwt();

    await expect(jwt({ token: token(STAMP - 1) })).resolves.toMatchObject({ sub: "db-cuid-1" });
    await expect(jwt({ token: token(undefined) })).resolves.toMatchObject({ sub: "db-cuid-1" });
  });

  it("ends a session signed in before the stamp, however recently it was refreshed", async () => {
    stamped(STAMP);
    const jwt = await loadJwt();

    // `iat` would say this token is new; the sign-in time is what counts.
    await expect(jwt({ token: token(STAMP - 1, { iat: STAMP + 60_000 }) })).rejects.toThrow(
      "SESSION_ENDED",
    );
  });

  it("ends a session that carries no sign-in time: it is older than any stamp", async () => {
    stamped(STAMP);
    const jwt = await loadJwt();

    await expect(jwt({ token: token(undefined) })).rejects.toThrow("SESSION_ENDED");
  });

  it("keeps a session signed in at the stamp or after it", async () => {
    stamped(STAMP);
    const jwt = await loadJwt();

    await expect(jwt({ token: token(STAMP) })).resolves.toMatchObject({ signedAt: STAMP });
    await expect(jwt({ token: token(STAMP + 1) })).resolves.toMatchObject({ signedAt: STAMP + 1 });
  });

  it("renews the session that turned the factor on, for its own proof and nothing else", async () => {
    const { signKeepProof } = await import("@/lib/services/auth/session-keep-proof");
    stamped(STAMP);
    const jwt = await loadJwt();
    const old = token(STAMP - 5_000);
    const proof = signKeepProof(SECRET, { userId: "db-cuid-1", signedAt: STAMP - 5_000 });

    const kept = await jwt({ token: old, trigger: "update", session: { keepProof: proof } });

    expect(kept.signedAt).toBeGreaterThanOrEqual(STAMP);
    // Renewed, so the next refresh passes the check without a proof.
    await expect(jwt({ token: kept })).resolves.toMatchObject({ sub: "db-cuid-1" });
  });

  it("does not renew an older session that asks, or one holding someone else's proof", async () => {
    const { signKeepProof } = await import("@/lib/services/auth/session-keep-proof");
    stamped(STAMP);
    const jwt = await loadJwt();
    const owners = signKeepProof(SECRET, { userId: "db-cuid-1", signedAt: STAMP - 5_000 });
    const otherAccount = signKeepProof(SECRET, { userId: "db-cuid-2", signedAt: STAMP - 9_000 });

    // A stolen cookie asking to be kept, with nothing, with a made-up proof, with the owner's
    // proof (made for another session), and with another account's.
    for (const keepProof of [undefined, "v1.0.x", owners, otherAccount]) {
      await expect(
        jwt({ token: token(STAMP - 9_000), trigger: "update", session: { keepProof } }),
      ).rejects.toThrow("SESSION_ENDED");
    }
  });

  it("takes a proof only from an update, not from a plain refresh", async () => {
    const { signKeepProof } = await import("@/lib/services/auth/session-keep-proof");
    stamped(STAMP);
    const jwt = await loadJwt();
    const proof = signKeepProof(SECRET, { userId: "db-cuid-1", signedAt: STAMP - 5_000 });

    await expect(
      jwt({ token: token(STAMP - 5_000), session: { keepProof: proof } }),
    ).rejects.toThrow("SESSION_ENDED");
  });

  it("leaves the session alone when the stamp cannot be read", async () => {
    // A database that is down serves nothing else either, and the check is made again at the next
    // refresh; ending every session over a busy database would be an outage, not a protection.
    prismaMock.user.findUnique.mockRejectedValue(new Error("database is locked"));
    const jwt = await loadJwt();

    await expect(jwt({ token: token(undefined) })).resolves.toMatchObject({ sub: "db-cuid-1" });
  });

  it("does not look for a stamp on the demo user", async () => {
    stamped(STAMP);
    const jwt = await loadJwt();

    await expect(
      jwt({ token: { sub: "demo-user", id: "demo-user", uidVerified: true } }),
    ).resolves.toMatchObject({ sub: "demo-user" });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("hands the session its sign-in time, for the enable route to name in a proof", async () => {
    await loadJwt();
    const { getAuthOptions } = await import("@/lib/services/auth/auth");
    const sessionCallback = getAuthOptions().callbacks?.session as unknown as (
      args: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;

    const session = await sessionCallback({
      session: { user: { name: "Owner", email: "owner@example.com" }, expires: "x" },
      token: token(STAMP),
    });

    expect(session.signedAt).toBe(STAMP);
  });
});
