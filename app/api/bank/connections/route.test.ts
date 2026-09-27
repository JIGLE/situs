import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The connections list: what each connection offers the owner, decided on the server, and that
 * the consent id read to decide it never leaves.
 */

const { access, prismaMock } = vi.hoisted(() => ({
  access: vi.fn(),
  prismaMock: { bankConnection: { findMany: vi.fn() } },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: access,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/services/bank/sync", () => ({ remainingBudget: vi.fn(async () => 4) }));

import { createFakeProvider } from "@/lib/services/bank/providers/fake-provider";
import { __registerProviderForTest } from "@/lib/services/bank/providers/registry";
import { GET } from "./route";

function stored(id: string, overrides: Record<string, unknown> = {}, movements = 0) {
  return {
    id,
    provider: "psd2_fake",
    institutionName: "Banco BPI",
    label: null,
    status: "active",
    lastSyncAt: null,
    consentExpiresAt: null,
    consentId: `session-${id}`,
    accounts: [{ _count: { transactions: movements } }],
    ...overrides,
  };
}

async function list() {
  const res = await GET(new NextRequest("http://localhost:3000/api/bank/connections"));
  const body = await res.json();
  const byId = Object.fromEntries(
    (body.data.connections as { id: string }[]).map((connection) => [connection.id, connection]),
  );
  return { res, body, byId };
}

let unregister: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
  unregister = __registerProviderForTest(createFakeProvider({ key: "fake" }));
});

afterEach(() => {
  unregister?.();
  unregister = undefined;
});

describe("GET /api/bank/connections", () => {
  it("never sends a consent id, and says whether disconnecting reaches the bank", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([
      stored("live", { label: "Conta da casa" }, 3),
      stored("older", { consentId: null }),
    ]);

    const { res, body, byId } = await list();

    expect(res.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("session-");
    expect(Object.keys(byId.live)).not.toContain("consentId");
    expect(byId.live).toMatchObject({ label: "Conta da casa", revocable: true, movements: 3 });
    expect(byId.older).toMatchObject({ revocable: false });
    expect(prismaMock.bankConnection.findMany.mock.calls[0][0].where).toEqual({ userId: "user-1" });
  });

  it("offers removal only to a connection that brought no movements", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([
      stored("busy", {}, 3),
      stored("empty", {}, 0),
    ]);

    const { byId } = await list();

    expect(byId.busy).toMatchObject({ movements: 3, canRemove: false });
    expect(byId.empty).toMatchObject({ movements: 0, canRemove: true });
  });

  it("offers renewal and disconnection only where the server would do them", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([
      stored("expired", { status: "expired" }),
      stored("pending", { status: "pending_consent", consentId: null }),
      stored("stopped", { status: "revoked" }),
      stored("stopped-done", { status: "revoked", consentId: null }),
      stored(
        "manual",
        { provider: "manual", consentId: null, institutionName: "Manual import" },
        5,
      ),
      stored("gone", { provider: "psd2_gone" }),
    ]);

    const { byId } = await list();

    expect(byId.expired).toMatchObject({ canRenew: true, canDisconnect: true });
    expect(byId.pending).toMatchObject({ canRenew: false, canDisconnect: false });
    // A disconnected connection can be renewed, and disconnected again only while its consent
    // is still held, so a refusal at the bank can be asked about again.
    expect(byId.stopped).toMatchObject({ canRenew: true, canDisconnect: true });
    expect(byId["stopped-done"]).toMatchObject({ canRenew: true, canDisconnect: false });
    expect(byId.manual).toMatchObject({ canRenew: false, canDisconnect: false, canSync: false });
    // A provider this build no longer ships cannot be renewed, but it can still be stopped.
    expect(byId.gone).toMatchObject({ canRenew: false, canDisconnect: true, revocable: false });
  });

  it("refuses a caller who is not an owner before reading anything", async () => {
    access.mockResolvedValue(new Response(null, { status: 403 }));

    const res = await GET(new NextRequest("http://localhost:3000/api/bank/connections"));

    expect(res.status).toBe(403);
    expect(prismaMock.bankConnection.findMany).not.toHaveBeenCalled();
  });
});
