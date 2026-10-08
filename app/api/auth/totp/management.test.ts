// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { totpGenerate, totpGenerateSecret } from "@/lib/utils/totp";

/**
 * Setting the second factor up, confirming it and turning it off.
 *
 * `/api/auth/**` is public in proxy.ts: the proxy checks neither the session nor the CSRF token
 * there, so each of these routes has to. Before, none checked the token, and `GET setup` also wrote
 * `totpEnabled: false`, so a link followed while signed in switched an enabled second factor off.
 * The session is read the way every handler reads it, through `requireAuth`, so a session still
 * waiting for its code is refused here as well.
 */

const { prisma, session } = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
  session: { current: null as Record<string, unknown> | null },
}));

const { limited } = vi.hoisted(() => ({
  limited: { current: null as Response | null, keys: [] as string[] },
}));
vi.mock("@/lib/middleware/rate-limit", () => ({
  RateLimits: { AUTH: {} },
  rateLimit: vi.fn(async (_request: unknown, config: { identifier?: () => string }) => {
    limited.keys.push(config.identifier?.() ?? "");
    return limited.current;
  }),
}));

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn(async () => session.current) }));
vi.mock("@/lib/services/auth/auth", () => ({ getAuthOptions: () => ({}) }));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prisma }));
// Encryption has its own tests. Here it tags a value, so a route that stored one in clear, or read
// one it had not decrypted, fails instead of passing on its own plaintext.
vi.mock("@/lib/utils/pii-encryption", () => ({
  encryptPII: (value: string) => `enc:${value}`,
  decryptPII: (value: string) => {
    if (!value.startsWith("enc:")) throw new Error("read a value that was never encrypted");
    return value.slice(4);
  },
}));

import * as setupRoute from "./setup/route";
import { POST as enable } from "./enable/route";
import { DELETE as disable } from "./disable/route";

const TOKEN = "csrf-token-0123456789";
const SIGNED_IN = { user: { id: "user-1", email: "owner@example.test" } };
const WAITING_FOR_CODE = { ...SIGNED_IN, mfaPending: true };

/** What the app's own client sends: the `csrf-token` cookie, echoed in the `x-csrf-token` header. */
const withToken = { cookie: `csrf-token=${TOKEN}`, "x-csrf-token": TOKEN };

function request(method: string, path: string, init: { token?: boolean; body?: unknown } = {}) {
  const { token = true, body } = init;
  return new NextRequest(`https://example.test/api/auth/totp/${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? withToken : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const setup = (init?: { token?: boolean }) => setupRoute.POST(request("POST", "setup", init));
const confirm = (code: string, init?: { token?: boolean }) =>
  enable(request("POST", "enable", { ...init, body: { code } }));
const turnOff = (init?: { token?: boolean; code?: string }) =>
  disable(
    request("DELETE", "disable", {
      token: init?.token,
      body: init?.code === undefined ? undefined : { code: init.code },
    }),
  );

const nothingWritten = () => {
  expect(prisma.user.update).not.toHaveBeenCalled();
  expect(prisma.user.updateMany).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  session.current = SIGNED_IN;
  limited.current = null;
  limited.keys = [];
  prisma.user.findUnique.mockResolvedValue({
    id: "user-1",
    email: "owner@example.test",
    totpEnabled: false,
    totpSecret: null,
  });
  prisma.user.update.mockResolvedValue({});
  prisma.user.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/auth/totp/setup", () => {
  it("is not a GET: a state change is not reachable by following a link", () => {
    expect(setupRoute).not.toHaveProperty("GET");
  });

  it("answers no session with a 401, before it looks at the token", async () => {
    session.current = null;

    const res = await setup({ token: false });

    expect(res.status).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a session still waiting for its code", async () => {
    session.current = WAITING_FOR_CODE;

    const res = await setup();

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ reason: "mfa_required" });
    nothingWritten();
  });

  it("refuses a request without the CSRF token, and reads and writes nothing", async () => {
    const res = await setup({ token: false });

    expect(res.status).toBe(403);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    nothingWritten();
  });

  it("refuses a token that is not the one in its cookie", async () => {
    const res = await setupRoute.POST(
      new NextRequest("https://example.test/api/auth/totp/setup", {
        method: "POST",
        headers: { cookie: `csrf-token=${TOKEN}`, "x-csrf-token": "another-token-9876543210" },
      }),
    );

    expect(res.status).toBe(403);
    nothingWritten();
  });

  it("stores a pending secret for an account whose second factor is off", async () => {
    const res = await setup();
    const body = (await res.json()) as { secret: string; qrDataUrl: string; otpauth: string };

    expect(res.status).toBe(200);
    expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(body.otpauth).toMatch(/^otpauth:\/\/totp\//);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", totpEnabled: false },
      data: { totpSecret: `enc:${body.secret}` },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses to replace a second factor that is on, and writes nothing", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "owner@example.test",
      totpEnabled: true,
      totpSecret: `enc:${totpGenerateSecret()}`,
    });

    const res = await setup();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "totp_already_enabled" });
    nothingWritten();
  });

  it("keeps a second factor that was confirmed between its read and its write", async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    const res = await setup();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "totp_already_enabled" });
  });
});

describe("POST /api/auth/totp/enable", () => {
  const secret = totpGenerateSecret();
  const pending = `enc:${secret}`;

  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      totpEnabled: false,
      totpSecret: pending,
    });
  });

  it("answers no session with a 401, before it looks at the token", async () => {
    session.current = null;

    const res = await confirm(totpGenerate(secret), { token: false });

    expect(res.status).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a request without the CSRF token, and reads and writes nothing", async () => {
    const res = await confirm(totpGenerate(secret), { token: false });

    expect(res.status).toBe(403);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    nothingWritten();
  });

  it("turns it on for the right code, and returns the backup codes it stored hashed", async () => {
    const res = await confirm(totpGenerate(secret));
    const { backupCodes } = (await res.json()) as { backupCodes: string[] };

    expect(res.status).toBe(200);
    expect(backupCodes).toHaveLength(10);
    const written = prisma.user.updateMany.mock.calls[0][0] as {
      where: { id: string; totpSecret: string };
      data: { totpEnabled: boolean; totpBackupCodes: string };
    };
    // For the secret the code was checked against, and the backup codes stored encrypted and hashed.
    expect(written.where).toEqual({ id: "user-1", totpSecret: pending });
    expect(written.data.totpEnabled).toBe(true);
    expect(written.data.totpBackupCodes.startsWith("enc:")).toBe(true);
    expect(JSON.parse(written.data.totpBackupCodes.slice(4))).toEqual(
      backupCodes.map((code) => createHash("sha256").update(code).digest("hex")),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("does not turn it on when a disable or a new setup changed the secret since it read it", async () => {
    // The write is for the secret the code was checked against; the row no longer has it.
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    const res = await confirm(totpGenerate(secret));

    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body).toMatchObject({ reason: "totp_setup_changed" });
    expect(body).not.toHaveProperty("backupCodes");
  });

  it("answers a wrong code with a 400 and turns nothing on", async () => {
    const res = await confirm("000000");

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid code" });
    nothingWritten();
  });

  it("answers an account that never set up with a 400", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      totpEnabled: false,
      totpSecret: null,
    });

    const res = await confirm("123456");

    expect(res.status).toBe(400);
    nothingWritten();
  });
});

describe("DELETE /api/auth/totp/disable", () => {
  it("answers no session with a 401, before it looks at the token", async () => {
    session.current = null;

    const res = await turnOff({ token: false });

    expect(res.status).toBe(401);
    nothingWritten();
  });

  it("refuses a session still waiting for its code, so the first factor alone cannot remove it", async () => {
    session.current = WAITING_FOR_CODE;

    const res = await turnOff();

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ reason: "mfa_required" });
    nothingWritten();
  });

  it("refuses a request without the CSRF token, and changes nothing", async () => {
    const res = await turnOff({ token: false });

    expect(res.status).toBe(403);
    nothingWritten();
  });

  it("clears a setup that was never confirmed without a code: there is no factor to prove", async () => {
    prisma.user.findUnique.mockResolvedValue({
      totpEnabled: false,
      totpSecret: "enc:PENDING",
      totpBackupCodes: null,
    });

    const res = await turnOff();

    expect(res.status).toBe(200);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", totpSecret: "enc:PENDING" },
      data: { totpEnabled: false, totpSecret: null, totpBackupCodes: null },
    });
  });

  describe("with the second factor on", () => {
    const secret = totpGenerateSecret();
    const backup = "A1B2C3D4";
    const hash = (code: string) => createHash("sha256").update(code).digest("hex");
    const on = (codes: string[] = [hash(backup)]) => ({
      totpEnabled: true,
      totpSecret: `enc:${secret}`,
      totpBackupCodes: `enc:${JSON.stringify(codes)}`,
    });

    beforeEach(() => prisma.user.findUnique.mockResolvedValue(on()));

    it("refuses a request that carries no code, and changes nothing", async () => {
      const res = await turnOff();

      expect(res.status).toBe(400);
      nothingWritten();
    });

    it("refuses a code that is the wrong shape, before comparing it with anything", async () => {
      for (const code of ["12345", "123456789"]) {
        const res = await turnOff({ code });
        expect(res.status).toBe(400);
      }
      nothingWritten();
    });

    it("refuses a six-digit code that is not the current one", async () => {
      const current = totpGenerate(secret);
      const wrong = current === "000000" ? "111111" : "000000";

      const res = await turnOff({ code: wrong });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "Invalid code" });
      nothingWritten();
    });

    it("refuses a code made for another secret", async () => {
      const res = await turnOff({ code: totpGenerate(totpGenerateSecret()) });

      expect(res.status).toBe(400);
      nothingWritten();
    });

    it("refuses a backup code that is not on the list, and one already spent", async () => {
      prisma.user.findUnique.mockResolvedValue(on([]));

      for (const code of ["FFFFFFFF", backup]) {
        const res = await turnOff({ code });
        expect(res.status).toBe(400);
      }
      nothingWritten();
    });

    it("turns it off for the current authenticator code, only for the secret that was checked", async () => {
      const res = await turnOff({ code: totpGenerate(secret) });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "user-1", totpSecret: `enc:${secret}` },
        data: { totpEnabled: false, totpSecret: null, totpBackupCodes: null },
      });
    });

    it("turns it off for a backup code, whatever its case", async () => {
      const res = await turnOff({ code: "a1b2c3d4" });

      expect(res.status).toBe(200);
      expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
    });

    it("answers a setup that changed since the code was checked with a 409, not a success", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      const res = await turnOff({ code: totpGenerate(secret) });

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ reason: "totp_setup_changed" });
    });

    it("counts a guess against the verify route's budget for the same user", async () => {
      await turnOff({ code: "000000" });

      expect(limited.keys).toEqual(["totp-verify:user-1"]);
    });

    it("answers a spent budget with the limiter's own response and checks no code", async () => {
      limited.current = new Response(null, { status: 429 });

      const res = await turnOff({ code: totpGenerate(secret) });

      expect(res.status).toBe(429);
      nothingWritten();
    });
  });
});
