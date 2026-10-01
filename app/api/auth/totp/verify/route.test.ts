// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { TEST_NEXTAUTH_SECRET, signedInHeaders } from "@/tests/helpers/session";
import { verifyMfaProof } from "@/lib/services/auth/mfa-proof";
import { totpGenerate, totpGenerateSecret } from "@/lib/utils/totp";

/**
 * Accepting a code, and who it releases.
 *
 * A code that is accepted is answered with a proof made for THE SESSION that sent it, which the code
 * page hands to its own session. This used to record the verification on the account and nothing
 * more, and any session of the account that refreshed in the next five minutes was released by it.
 * Carries real sessions, as the proxy's tests do: the route loads `getToken` the way the proxy does,
 * which a mock of `next-auth/jwt` does not reach (`tests/helpers/session.ts`).
 */

const { prisma, session, limited } = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
  session: { current: { user: { id: "user-1" } } as { user: { id: string } } | null },
  limited: { current: null as Response | null },
}));

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn(async () => session.current) }));
vi.mock("@/lib/services/auth/auth", () => ({ getAuthOptions: () => ({}) }));
vi.mock("@/lib/middleware/rate-limit", () => ({
  RateLimits: { AUTH: {} },
  rateLimit: vi.fn(async () => limited.current),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prisma }));
// Encryption has its own tests; here a stored value is its own plaintext.
vi.mock("@/lib/utils/pii-encryption", () => ({
  decryptPII: (value: string) => value,
  encryptPII: (value: string) => value,
}));

import { POST } from "./route";

const TOTP_SECRET = totpGenerateSecret();
const BACKUP_CODE = "ABCD1234";
const hashed = (code: string) => createHash("sha256").update(code).digest("hex");

const send = async (code: string, claims: Record<string, unknown> | null) =>
  POST(
    new NextRequest("https://example.test/api/auth/totp/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(claims ? await signedInHeaders(claims) : {}),
      },
      body: JSON.stringify({ code }),
    }),
  );

const pendingAs = (sid: string) => ({ mfaPending: true, sid });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", TEST_NEXTAUTH_SECRET);
  session.current = { user: { id: "user-1" } };
  limited.current = null;
  prisma.user.findUnique.mockResolvedValue({
    totpEnabled: true,
    totpSecret: TOTP_SECRET,
    totpBackupCodes: JSON.stringify([hashed(BACKUP_CODE), hashed("EEEE5555")]),
  });
  prisma.user.update.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/totp/verify", () => {
  it("answers a good code with a proof made for the session that sent it", async () => {
    const res = await send(totpGenerate(TOTP_SECRET), pendingAs("sid-1"));
    const body = (await res.json()) as { ok: boolean; proof: string };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(
      verifyMfaProof(TEST_NEXTAUTH_SECRET, body.proof, { userId: "user-1", sid: "sid-1" }),
    ).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { totpVerifiedAt: expect.any(Date) },
    });
  });

  it("makes a proof that fits no other session, however the code came by", async () => {
    // One owner, two sessions, each with its own cookie: the code one enters releases only itself.
    const mine = (await (await send(totpGenerate(TOTP_SECRET), pendingAs("sid-mine"))).json()) as {
      proof: string;
    };

    expect(
      verifyMfaProof(TEST_NEXTAUTH_SECRET, mine.proof, { userId: "user-1", sid: "sid-theirs" }),
    ).toBe(false);
    expect(
      verifyMfaProof(TEST_NEXTAUTH_SECRET, mine.proof, { userId: "user-2", sid: "sid-mine" }),
    ).toBe(false);
  });

  it("answers a good backup code with a proof too, and spends the code", async () => {
    const res = await send(BACKUP_CODE, pendingAs("sid-1"));
    const body = (await res.json()) as { ok: boolean; proof: string };

    expect(res.status).toBe(200);
    expect(
      verifyMfaProof(TEST_NEXTAUTH_SECRET, body.proof, { userId: "user-1", sid: "sid-1" }),
    ).toBe(true);
    const update = prisma.user.update.mock.calls[0][0] as {
      data: { totpBackupCodes: string };
    };
    expect(JSON.parse(update.data.totpBackupCodes)).toEqual([hashed("EEEE5555")]);
  });

  it("answers a wrong code with a 400 and no proof", async () => {
    const res = await send("000000", pendingAs("sid-1"));

    expect(res.status).toBe(400);
    expect(await res.json()).not.toHaveProperty("proof");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses a session that is not waiting for a code, before reading anything", async () => {
    const res = await send(totpGenerate(TOTP_SECRET), {});

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "mfa_not_pending" });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses a request that carries no session token at all", async () => {
    const res = await send(totpGenerate(TOTP_SECRET), null);

    expect(res.status).toBe(409);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses a pending session that has no name yet, and spends no backup code on it", async () => {
    // It is named at its next refresh, which the code page causes by reading the session. A code
    // accepted for a session that cannot be released would be lost: a backup code is single-use.
    const res = await send(BACKUP_CODE, { mfaPending: true });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ reason: "mfa_session_unnamed" });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("answers no session with a 401", async () => {
    session.current = null;

    const res = await send(totpGenerate(TOTP_SECRET), pendingAs("sid-1"));

    expect(res.status).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("is rate limited per user before it reads a code", async () => {
    limited.current = new Response(null, { status: 429 });

    const res = await send(totpGenerate(TOTP_SECRET), pendingAs("sid-1"));

    expect(res.status).toBe(429);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
