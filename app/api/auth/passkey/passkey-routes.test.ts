// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { TEST_NEXTAUTH_SECRET, signedInHeaders } from "@/tests/helpers/session";
import { verifyMfaProof } from "@/lib/services/auth/mfa-proof";
import { openChallenge, signChallenge } from "@/lib/services/auth/passkey";
import { totpGenerate, totpGenerateSecret } from "@/lib/utils/totp";

/**
 * The passkey routes: who may add, remove and use one, and what a sign-in with one releases.
 *
 * The WebAuthn library is mocked (the signature check has its own end-to-end proof in
 * `e2e/passkey-sign-in.spec.ts`, against a real authenticator); what is pinned here is everything
 * around it: the code an addition takes, the account every query is scoped to, and that the proof a
 * sign-in hands back opens THE session that asked and no other.
 */

const { prisma, session, limited, webauthn } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    passkey: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  session: { current: { user: { id: "user-1" } } as { user: { id: string } } | null },
  limited: { current: null as Response | null, keys: [] as string[] },
  webauthn: {
    generateRegistrationOptions: vi.fn(),
    verifyRegistrationResponse: vi.fn(),
    generateAuthenticationOptions: vi.fn(),
    verifyAuthenticationResponse: vi.fn(),
  },
}));

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn(async () => session.current) }));
vi.mock("@/lib/services/auth/auth", () => ({ getAuthOptions: () => ({}) }));
vi.mock("@/lib/middleware/rate-limit", () => ({
  RateLimits: { AUTH: {} },
  rateLimit: vi.fn(async (_r: unknown, config: { identifier?: () => string; scope?: string }) => {
    limited.keys.push(`${config.identifier?.() ?? ""}|${config.scope ?? ""}`);
    return limited.current;
  }),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prisma }));
vi.mock("@/lib/utils/pii-encryption", () => ({
  decryptPII: (value: string) => value,
  encryptPII: (value: string) => value,
}));
vi.mock("@simplewebauthn/server", () => webauthn);

import { POST as registerOptions } from "./register/options/route";
import { POST as registerVerify } from "./register/verify/route";
import { POST as authOptions } from "./authenticate/options/route";
import { POST as authVerify } from "./authenticate/verify/route";
import { DELETE as removePasskey } from "./[id]/route";
import { GET as listPasskeys } from "./route";

const TOTP_SECRET = totpGenerateSecret();
const CSRF = "csrf-token-0123456789";
const csrfHeaders = { cookie: `csrf-token=${CSRF}`, "x-csrf-token": CSRF };
const SIGNED_IN = { user: { id: "user-1", email: "owner@example.test" } };
const USER = {
  id: "user-1",
  email: "owner@example.test",
  name: "Owner",
  totpEnabled: true,
  totpSecret: TOTP_SECRET,
  totpBackupCodes: null,
};
const STORED = {
  id: "p1",
  userId: "user-1",
  credentialId: "cred-1",
  publicKey: Buffer.from("public-key").toString("base64url"),
  counter: 4,
  transports: JSON.stringify(["internal"]),
  deviceType: "multiDevice",
  backedUp: true,
  name: "Pixel 9",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  lastUsedAt: null,
};

const url = (path: string) => `https://example.test/api/auth/passkey/${path}`;

const json = (path: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url(path), {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** A request carrying a real session (the pending routes read the token the way the proxy does). */
const asSession = async (path: string, body: unknown, claims: Record<string, unknown> | null) =>
  new NextRequest(url(path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(claims ? await signedInHeaders(claims) : {}),
    },
    body: JSON.stringify(body),
  });

const pendingAs = (sid: string) => ({ mfaPending: true, sid });
const challengeFor = (scope: Parameters<typeof signChallenge>[1]) =>
  signChallenge(TEST_NEXTAUTH_SECRET, scope, "the-challenge");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", TEST_NEXTAUTH_SECRET);
  vi.stubEnv("NEXTAUTH_URL", "https://situs.example.pt");
  session.current = { user: { id: "user-1" } };
  limited.current = null;
  limited.keys = [];
  prisma.user.findUnique.mockResolvedValue({ ...USER, passkeys: [] });
  prisma.user.update.mockResolvedValue({});
  prisma.passkey.findMany.mockResolvedValue([]);
  prisma.passkey.findFirst.mockResolvedValue(STORED);
  prisma.passkey.findUnique.mockResolvedValue(null);
  prisma.passkey.create.mockResolvedValue(STORED);
  prisma.passkey.update.mockResolvedValue({});
  prisma.passkey.deleteMany.mockResolvedValue({ count: 1 });
  webauthn.generateRegistrationOptions.mockResolvedValue({ challenge: "reg-challenge", rp: {} });
  webauthn.generateAuthenticationOptions.mockResolvedValue({ challenge: "auth-challenge" });
});

afterEach(() => vi.unstubAllEnvs());

describe("saving a passkey: POST register/options", () => {
  const start = (code: string, headers: Record<string, string> = csrfHeaders) =>
    registerOptions(json("register/options", "POST", { code }, headers));

  beforeEach(() => {
    // requireAuth reads the session through getServerSession; a signed-in one has no mfaPending.
    session.current = SIGNED_IN;
  });

  it("is refused without the CSRF token, before a code is looked at", async () => {
    const res = await start(totpGenerate(TOTP_SECRET), {});

    expect(res.status).toBe(403);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("is refused for an account without the authenticator app: the app is what a lost passkey falls back to", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...USER, totpEnabled: false, passkeys: [] });

    const res = await start(totpGenerate(TOTP_SECRET));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "totp_required" });
    expect(webauthn.generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it("takes a code from the app: a wrong one starts nothing", async () => {
    const wrong = totpGenerate(TOTP_SECRET) === "000000" ? "111111" : "000000";

    const res = await start(wrong);

    expect(res.status).toBe(400);
    expect(webauthn.generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it("meters guesses in the account's one budget, shared with the code page", async () => {
    await start(totpGenerate(TOTP_SECRET));

    expect(limited.keys).toContain("totp-verify:user-1|totp-code");
  });

  it("answers a spent budget with its own refusal", async () => {
    limited.current = new Response("{}", { status: 429 });

    const res = await start(totpGenerate(TOTP_SECRET));

    expect(res.status).toBe(429);
    expect(webauthn.generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it("offers the instance's site, requires the person to be verified, and signs a challenge for this account", async () => {
    const res = await start(totpGenerate(TOTP_SECRET));
    const body = (await res.json()) as { token: string };

    expect(res.status).toBe(200);
    expect(webauthn.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: "situs.example.pt",
        authenticatorSelection: expect.objectContaining({ userVerification: "required" }),
      }),
    );
    expect(body.token.startsWith("v1.")).toBe(true);
  });

  it("signs the challenge the library put in the options: that is what the browser signs", async () => {
    const res = await start(totpGenerate(TOTP_SECRET));
    const { token } = (await res.json()) as { token: string };

    expect(openChallenge(TEST_NEXTAUTH_SECRET, token, { kind: "register", userId: "user-1" })).toBe(
      "reg-challenge",
    );
    // Never one of ours handed to the library: it would re-encode a string before sending it.
    expect(webauthn.generateRegistrationOptions).not.toHaveBeenCalledWith(
      expect.objectContaining({ challenge: expect.anything() }),
    );
  });

  it("refuses an account that holds as many as it may", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...USER,
      passkeys: Array.from({ length: 10 }, (_, i) => ({ credentialId: `c${i}`, transports: null })),
    });

    const res = await start(totpGenerate(TOTP_SECRET));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "passkey_limit" });
  });
});

describe("saving a passkey: POST register/verify", () => {
  beforeEach(() => {
    session.current = SIGNED_IN;
    prisma.user.findUnique.mockResolvedValue({ totpEnabled: true, _count: { passkeys: 0 } });
    webauthn.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: "cred-1", publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    });
  });

  const finish = (token: string, extra: Record<string, unknown> = {}) =>
    registerVerify(
      json(
        "register/verify",
        "POST",
        {
          token,
          name: "  My   phone ",
          response: { id: "cred-1", response: { transports: ["internal"] } },
          ...extra,
        },
        csrfHeaders,
      ),
    );

  it("stores only the public key, under the name the owner gave, for this account", async () => {
    const res = await finish(challengeFor({ kind: "register", userId: "user-1" }));

    expect(res.status).toBe(200);
    expect(prisma.passkey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          credentialId: "cred-1",
          publicKey: Buffer.from([1, 2, 3]).toString("base64url"),
          name: "My phone",
          deviceType: "multiDevice",
          transports: JSON.stringify(["internal"]),
        }),
      }),
    );
    const body = JSON.stringify(await res.json());
    expect(body).not.toMatch(/cred-1|publicKey/);
  });

  it.each([
    ["a sign-in challenge", { kind: "authenticate", userId: "user-1", sid: "s" } as const],
    ["another account's challenge", { kind: "register", userId: "user-2" } as const],
  ])("refuses %s", async (_name, scope) => {
    const res = await finish(challengeFor(scope));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "passkey_challenge_expired" });
    expect(webauthn.verifyRegistrationResponse).not.toHaveBeenCalled();
    expect(prisma.passkey.create).not.toHaveBeenCalled();
  });

  it("saves nothing when the authenticator's answer does not hold up", async () => {
    webauthn.verifyRegistrationResponse.mockRejectedValue(new Error("origin mismatch"));

    const res = await finish(challengeFor({ kind: "register", userId: "user-1" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "passkey_invalid" });
    expect(prisma.passkey.create).not.toHaveBeenCalled();
  });

  it("will not save a credential twice", async () => {
    prisma.passkey.findUnique.mockResolvedValue({ id: "p1" });

    const res = await finish(challengeFor({ kind: "register", userId: "user-1" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "passkey_exists" });
  });

  it("answers a credential finished twice at once with a 409, not a 500", async () => {
    prisma.passkey.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    const res = await finish(challengeFor({ kind: "register", userId: "user-1" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "passkey_exists" });
  });

  it("saves none once the app has been turned off since the ceremony began", async () => {
    prisma.user.findUnique.mockResolvedValue({ totpEnabled: false, _count: { passkeys: 0 } });

    const res = await finish(challengeFor({ kind: "register", userId: "user-1" }));

    expect(res.status).toBe(409);
    expect(prisma.passkey.create).not.toHaveBeenCalled();
  });
});

describe("removing a passkey: DELETE [id]", () => {
  beforeEach(() => {
    session.current = SIGNED_IN;
  });

  const remove = (id: string, code: string, headers: Record<string, string> = csrfHeaders) =>
    removePasskey(json(`${id}`, "DELETE", { code }, headers), { params: Promise.resolve({ id }) });

  it("takes a code from the app, and a wrong one removes nothing", async () => {
    const wrong = totpGenerate(TOTP_SECRET) === "000000" ? "111111" : "000000";

    const res = await remove("p1", wrong);

    expect(res.status).toBe(400);
    expect(prisma.passkey.deleteMany).not.toHaveBeenCalled();
  });

  it("is scoped to the account: another's id is simply not found", async () => {
    prisma.passkey.deleteMany.mockResolvedValue({ count: 0 });

    const res = await remove("someone-elses", totpGenerate(TOTP_SECRET));

    expect(prisma.passkey.deleteMany).toHaveBeenCalledWith({
      where: { id: "someone-elses", userId: "user-1" },
    });
    expect(res.status).toBe(404);
  });

  it("removes one for a right code", async () => {
    const res = await remove("p1", totpGenerate(TOTP_SECRET));

    expect(res.status).toBe(200);
    expect(prisma.passkey.deleteMany).toHaveBeenCalledWith({
      where: { id: "p1", userId: "user-1" },
    });
  });

  it("is refused without the CSRF token", async () => {
    const res = await remove("p1", totpGenerate(TOTP_SECRET), {});

    expect(res.status).toBe(403);
    expect(prisma.passkey.deleteMany).not.toHaveBeenCalled();
  });
});

describe("a session that has passed only its first factor", () => {
  const WAITING = { ...SIGNED_IN, mfaPending: true };

  it("cannot add, finish adding, remove or list passkeys", async () => {
    session.current = WAITING as typeof session.current;
    const claims = await signedInHeaders({ mfaPending: true, sid: "s1" });
    const headers = { ...csrfHeaders, ...claims };

    const responses = [
      await registerOptions(json("register/options", "POST", { code: "123456" }, headers)),
      await registerVerify(
        json("register/verify", "POST", { token: "t", response: { id: "x" } }, headers),
      ),
      await removePasskey(json("p1", "DELETE", { code: "123456" }, headers), {
        params: Promise.resolve({ id: "p1" }),
      }),
      await listPasskeys(new NextRequest(url(""), { headers: claims })),
    ];

    for (const res of responses) expect(res.status).toBe(401);
    expect(prisma.passkey.create).not.toHaveBeenCalled();
    expect(prisma.passkey.deleteMany).not.toHaveBeenCalled();
  });
});

describe("a body that is not JSON", () => {
  const garbage = (path: string, method = "POST", headers: Record<string, string> = csrfHeaders) =>
    new NextRequest(url(path), {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: "{not json",
    });

  it("is a 400 on every route that reads one, never a 500", async () => {
    session.current = SIGNED_IN;

    expect((await registerOptions(garbage("register/options"))).status).toBe(400);
    expect((await registerVerify(garbage("register/verify"))).status).toBe(400);
    expect(
      (await removePasskey(garbage("p1", "DELETE"), { params: Promise.resolve({ id: "p1" }) }))
        .status,
    ).toBe(400);

    const claims = await signedInHeaders({ mfaPending: true, sid: "s1" });
    const bad = new NextRequest(url("authenticate/verify"), {
      method: "POST",
      headers: { "content-type": "application/json", ...claims },
      body: "{not json",
    });
    expect((await authVerify(bad)).status).toBe(400);
  });
});

describe("listing: GET", () => {
  it("is scoped to the account and shows no credential or key", async () => {
    session.current = SIGNED_IN;
    prisma.passkey.findMany.mockResolvedValue([STORED]);

    const res = await listPasskeys(new NextRequest(url("")));
    const text = JSON.stringify(await res.json());

    expect(prisma.passkey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    );
    expect(text).toContain("Pixel 9");
    expect(text).not.toMatch(/cred-1|public/i);
  });
});

describe("signing in with a passkey: authenticate/*", () => {
  describe("who may ask", () => {
    it("refuses a visitor with no session", async () => {
      session.current = null;

      const res = await authOptions(await asSession("authenticate/options", {}, null));

      expect(res.status).toBe(401);
    });

    it("refuses a session that is not waiting for its second factor", async () => {
      const res = await authOptions(await asSession("authenticate/options", {}, {}));

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ reason: "mfa_not_pending" });
    });

    it("refuses a pending session that has no name yet", async () => {
      const res = await authOptions(
        await asSession("authenticate/options", {}, { mfaPending: true }),
      );

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ reason: "mfa_session_unnamed" });
    });

    it("says so when the account has no passkey", async () => {
      const res = await authOptions(await asSession("authenticate/options", {}, pendingAs("s1")));

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ reason: "no_passkey" });
    });
  });

  it("names the account's passkeys and signs a challenge for THIS sign-in", async () => {
    prisma.passkey.findMany.mockResolvedValue([STORED]);

    const res = await authOptions(await asSession("authenticate/options", {}, pendingAs("s1")));
    const body = (await res.json()) as { token: string };

    expect(res.status).toBe(200);
    expect(prisma.passkey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    );
    expect(webauthn.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: "situs.example.pt",
        userVerification: "required",
        allowCredentials: [{ id: "cred-1", transports: ["internal"] }],
      }),
    );
    expect(body.token.startsWith("v1.")).toBe(true);
    expect(
      openChallenge(TEST_NEXTAUTH_SECRET, body.token, {
        kind: "authenticate",
        userId: "user-1",
        sid: "s1",
      }),
    ).toBe("auth-challenge");
    expect(webauthn.generateAuthenticationOptions).not.toHaveBeenCalledWith(
      expect.objectContaining({ challenge: expect.anything() }),
    );
  });

  describe("POST authenticate/verify", () => {
    const answer = async (token: string, claims: Record<string, unknown> = pendingAs("s1")) =>
      authVerify(
        await asSession("authenticate/verify", { token, response: { id: "cred-1" } }, claims),
      );
    const mine = () => challengeFor({ kind: "authenticate", userId: "user-1", sid: "s1" });

    beforeEach(() => {
      webauthn.verifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 5 },
      });
    });

    it("releases the session that asked, with a proof made for it and for no other", async () => {
      const res = await answer(mine());
      const { proof } = (await res.json()) as { proof: string };

      expect(res.status).toBe(200);
      expect(verifyMfaProof(TEST_NEXTAUTH_SECRET, proof, { userId: "user-1", sid: "s1" })).toBe(
        true,
      );
      expect(verifyMfaProof(TEST_NEXTAUTH_SECRET, proof, { userId: "user-1", sid: "s2" })).toBe(
        false,
      );
      expect(verifyMfaProof(TEST_NEXTAUTH_SECRET, proof, { userId: "user-2", sid: "s1" })).toBe(
        false,
      );
    });

    it("keeps the counter and the time it was used", async () => {
      await answer(mine());

      expect(prisma.passkey.update).toHaveBeenCalledWith({
        where: { id: "p1" },
        data: expect.objectContaining({ counter: 5, lastUsedAt: expect.any(Date) }),
      });
    });

    it("looks the credential up for THIS account only", async () => {
      await answer(mine());

      expect(prisma.passkey.findFirst).toHaveBeenCalledWith({
        where: { credentialId: "cred-1", userId: "user-1" },
      });
    });

    it("refuses a challenge made for another session, and checks no signature", async () => {
      const res = await answer(challengeFor({ kind: "authenticate", userId: "user-1", sid: "s2" }));

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ reason: "passkey_challenge_expired" });
      expect(webauthn.verifyAuthenticationResponse).not.toHaveBeenCalled();
    });

    it("refuses a registration challenge", async () => {
      const res = await answer(challengeFor({ kind: "register", userId: "user-1" }));

      expect(res.status).toBe(400);
      expect(webauthn.verifyAuthenticationResponse).not.toHaveBeenCalled();
    });

    it("refuses a credential the account does not hold", async () => {
      prisma.passkey.findFirst.mockResolvedValue(null);

      const res = await answer(mine());

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ reason: "passkey_invalid" });
      expect(webauthn.verifyAuthenticationResponse).not.toHaveBeenCalled();
    });

    it("refuses once the authenticator app is off: a passkey is a way past it, not a factor", async () => {
      prisma.user.findUnique.mockResolvedValue({ totpEnabled: false });

      const res = await answer(mine());

      expect(res.status).toBe(400);
      expect(webauthn.verifyAuthenticationResponse).not.toHaveBeenCalled();
    });

    it.each([
      [
        "a signature that does not verify",
        () => webauthn.verifyAuthenticationResponse.mockResolvedValue({ verified: false }),
      ],
      [
        "a response the library rejects",
        () => webauthn.verifyAuthenticationResponse.mockRejectedValue(new Error("bad")),
      ],
    ])("releases nothing for %s", async (_name, arrange) => {
      arrange();

      const res = await answer(mine());
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(400);
      expect(body.proof).toBeUndefined();
      expect(prisma.passkey.update).not.toHaveBeenCalled();
    });

    it("asks the library for user verification, against the instance's own site", async () => {
      await answer(mine());

      expect(webauthn.verifyAuthenticationResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedOrigin: "https://situs.example.pt",
          expectedRPID: "situs.example.pt",
          requireUserVerification: true,
          expectedChallenge: "the-challenge",
        }),
      );
    });

    it("is metered per account", async () => {
      await answer(mine());

      expect(limited.keys).toContain("passkey-sign-in:user-1|passkey-sign-in");
    });
  });
});
