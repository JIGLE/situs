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

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn(async () => session.current) }));
vi.mock("@/lib/services/auth/auth", () => ({ getAuthOptions: () => ({}) }));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prisma }));
// Encryption has its own tests; here a stored value is its own plaintext.
vi.mock("@/lib/utils/pii-encryption", () => ({
  decryptPII: (value: string) => value,
  encryptPII: (value: string) => value,
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
const turnOff = (init?: { token?: boolean }) => disable(request("DELETE", "disable", init));

const nothingWritten = () => {
  expect(prisma.user.update).not.toHaveBeenCalled();
  expect(prisma.user.updateMany).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  session.current = SIGNED_IN;
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
      data: { totpSecret: body.secret },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses to replace a second factor that is on, and writes nothing", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "owner@example.test",
      totpEnabled: true,
      totpSecret: totpGenerateSecret(),
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

  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      totpEnabled: false,
      totpSecret: secret,
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
    const stored = prisma.user.update.mock.calls[0][0] as {
      where: { id: string };
      data: { totpEnabled: boolean; totpBackupCodes: string };
    };
    expect(stored.where).toEqual({ id: "user-1" });
    expect(stored.data.totpEnabled).toBe(true);
    expect(JSON.parse(stored.data.totpBackupCodes)).toEqual(
      backupCodes.map((code) => createHash("sha256").update(code).digest("hex")),
    );
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

  it("turns the second factor off for a signed-in request that carries the token", async () => {
    const res = await turnOff();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { totpEnabled: false, totpSecret: null, totpBackupCodes: null },
    });
  });
});
