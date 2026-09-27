import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const { warnMock, prismaMock, auditMock } = vi.hoisted(() => ({
  warnMock: vi.fn(),
  prismaMock: {
    bankConnection: { findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  },
  auditMock: vi.fn(),
}));
vi.mock("@/lib/utils/logger", () => ({ logger: { warn: warnMock } }));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: auditMock }));

import { ResourceNotFoundError } from "@/lib/utils/error-handling";
import { createFakeProvider, type FakeProvider } from "./providers/fake-provider";
import { __registerProviderForTest } from "./providers/registry";
import type { RevocationResult } from "./providers/types";
import {
  accessEnded,
  canDisconnect,
  disconnectConnection,
  removeConnection,
  renameConnection,
  revokeAtBank,
} from "./connections";

describe("revokeAtBank", () => {
  let unregister: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    unregister?.();
    unregister = undefined;
  });

  it("asks the connection's provider to end the consent", async () => {
    const fake = createFakeProvider({ key: "fake" });
    unregister = __registerProviderForTest(fake);

    await expect(revokeAtBank("psd2_fake", "session-1")).resolves.toBe("revoked");
    expect(fake.revocations).toEqual(["session-1"]);
  });

  it("passes on a consent the provider no longer knows", async () => {
    unregister = __registerProviderForTest(
      createFakeProvider({ key: "fake", revokeResult: "already_gone" }),
    );

    await expect(revokeAtBank("psd2_fake", "session-1")).resolves.toBe("already_gone");
  });

  it("reports a refusal instead of throwing, and never logs the consent id", async () => {
    unregister = __registerProviderForTest(
      createFakeProvider({ key: "fake", revokeResult: new Error("HTTP 403") }),
    );

    await expect(revokeAtBank("psd2_fake", "session-secret")).resolves.toBe("failed");
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain("session-secret");
  });

  it("has nothing to ask with for a connection whose id was never stored", async () => {
    await expect(revokeAtBank("psd2_fake", null)).resolves.toBe("no_consent_id");
  });

  it("says so when this instance no longer ships the provider", async () => {
    await expect(revokeAtBank("psd2_gone", "session-1")).resolves.toBe("provider_unavailable");
    await expect(revokeAtBank("manual", "session-1")).resolves.toBe("provider_unavailable");
  });

  it("treats only a confirmed end as the access ending", () => {
    expect(accessEnded("revoked")).toBe(true);
    expect(accessEnded("already_gone")).toBe(true);
    expect(accessEnded("failed")).toBe(false);
    expect(accessEnded("no_consent_id")).toBe(false);
    expect(accessEnded("provider_unavailable")).toBe(false);
  });
});

describe("canDisconnect", () => {
  let unregister: (() => void) | undefined;

  afterEach(() => {
    unregister?.();
    unregister = undefined;
  });

  it("offers it for a bank connection whose first consent completed", () => {
    expect(canDisconnect({ provider: "psd2_fake", status: "active", consentId: "s" })).toBe(true);
    expect(canDisconnect({ provider: "psd2_fake", status: "expired", consentId: null })).toBe(true);
    expect(
      canDisconnect({ provider: "psd2_fake", status: "pending_consent", consentId: null }),
    ).toBe(false);
    expect(canDisconnect({ provider: "manual", status: "active", consentId: null })).toBe(false);
  });

  it("offers it again once disconnected only while there is a consent to ask about", () => {
    unregister = __registerProviderForTest(createFakeProvider({ key: "fake" }));

    expect(canDisconnect({ provider: "psd2_fake", status: "revoked", consentId: "s" })).toBe(true);
    expect(canDisconnect({ provider: "psd2_fake", status: "revoked", consentId: null })).toBe(
      false,
    );
    // Nobody left to ask.
    expect(canDisconnect({ provider: "psd2_gone", status: "revoked", consentId: "s" })).toBe(false);
  });
});

describe("disconnectConnection", () => {
  const NOW = new Date("2026-09-27T12:00:00.000Z");
  let unregister: (() => void) | undefined;
  let revokeSpy: Mock<FakeProvider["revokeConsent"]>;

  function live(overrides: Record<string, unknown> = {}) {
    return {
      id: "conn-1",
      userId: "user-1",
      provider: "psd2_fake",
      institutionName: "Banco BPI",
      status: "active",
      consentId: "session-1",
      metadata: JSON.stringify({
        institutionId: "BANCOBPI_BBPIPTPL",
        accountRefs: { "acct-1": "remote-1" },
        renewal: {
          reference: "r".repeat(64),
          startedAt: NOW.toISOString(),
          providerRef: null,
          consentExpiresAt: null,
        },
      }),
      ...overrides,
    };
  }

  function register(revokeResult?: RevocationResult | Error) {
    const fake = createFakeProvider({ key: "fake", revokeResult });
    revokeSpy = vi.fn(fake.revokeConsent);
    unregister = __registerProviderForTest({ ...fake, revokeConsent: revokeSpy });
    return fake;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.bankConnection.findFirst.mockResolvedValue(live());
    prismaMock.bankConnection.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    unregister?.();
    unregister = undefined;
  });

  it("stops the connection first, then asks the bank, and lets the id go once it confirms", async () => {
    const fake = register();

    const result = await disconnectConnection("user-1", "conn-1", NOW);

    expect(result).toEqual({ connectionId: "conn-1", revocation: "revoked" });
    const [stop, release] = prismaMock.bankConnection.updateMany.mock.calls.map((call) => call[0]);
    // Conditional on the row as read, so a sync or a renewal landing meanwhile is not overwritten.
    expect(stop.where).toEqual({
      id: "conn-1",
      userId: "user-1",
      status: "active",
      consentId: "session-1",
      metadata: live().metadata,
    });
    expect(stop.data.status).toBe("revoked");
    // A parked renewal goes, so the bank's redirect cannot bring the connection back.
    expect(JSON.parse(stop.data.metadata)).toEqual({
      institutionId: "BANCOBPI_BBPIPTPL",
      accountRefs: { "acct-1": "remote-1" },
    });
    expect(fake.revocations).toEqual(["session-1"]);
    expect(revokeSpy.mock.invocationCallOrder[0]).toBeGreaterThan(
      prismaMock.bankConnection.updateMany.mock.invocationCallOrder[0],
    );
    expect(release).toEqual({
      where: { id: "conn-1", status: "revoked", consentId: "session-1" },
      data: { consentId: null, consentExpiresAt: NOW },
    });
  });

  it("records the disconnect without the consent id", async () => {
    register();

    await disconnectConnection("user-1", "conn-1", NOW);

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BANK_CONNECTION_DISCONNECTED",
        resourceId: "conn-1",
        details: expect.objectContaining({ previousStatus: "active", revocation: "revoked" }),
      }),
    );
    expect(JSON.stringify(auditMock.mock.calls)).not.toContain("session-1");
  });

  it("keeps the consent id when the bank does not confirm, so it can be asked again", async () => {
    register(new Error("HTTP 500"));

    const result = await disconnectConnection("user-1", "conn-1", NOW);

    expect(result.revocation).toBe("failed");
    // The status was written; the id and the expiry were not touched.
    expect(prismaMock.bankConnection.updateMany).toHaveBeenCalledTimes(1);
  });

  it("asks again for a disconnected connection whose revocation failed", async () => {
    const fake = register();
    prismaMock.bankConnection.findFirst.mockResolvedValue(live({ status: "revoked" }));

    await expect(disconnectConnection("user-1", "conn-1", NOW)).resolves.toMatchObject({
      revocation: "revoked",
    });
    expect(fake.revocations).toEqual(["session-1"]);
  });

  it("disconnects an older connection that has no id to revoke with", async () => {
    const fake = register();
    prismaMock.bankConnection.findFirst.mockResolvedValue(live({ consentId: null }));

    const result = await disconnectConnection("user-1", "conn-1", NOW);

    // Its access ends on its own date, or in the bank's app; the screen says so.
    expect(result.revocation).toBe("no_consent_id");
    expect(fake.revocations).toEqual([]);
    expect(prismaMock.bankConnection.updateMany.mock.calls[0][0].data.status).toBe("revoked");
  });

  it("refuses a manual connection and one whose first consent is unfinished", async () => {
    register();
    for (const row of [live({ provider: "manual" }), live({ status: "pending_consent" })]) {
      prismaMock.bankConnection.findFirst.mockResolvedValue(row);
      await expect(disconnectConnection("user-1", "conn-1", NOW)).rejects.toMatchObject({
        reason: "bank_connection_not_live",
      });
    }
    expect(prismaMock.bankConnection.updateMany).not.toHaveBeenCalled();
  });

  it("answers a connection that changed meanwhile, and asks the bank nothing", async () => {
    const fake = register();
    prismaMock.bankConnection.updateMany.mockResolvedValue({ count: 0 });

    await expect(disconnectConnection("user-1", "conn-1", NOW)).rejects.toMatchObject({
      reason: "bank_connection_changed",
    });
    expect(fake.revocations).toEqual([]);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the caller, and does not find another owner's connection", async () => {
    register();
    prismaMock.bankConnection.findFirst.mockResolvedValue(null);

    await expect(disconnectConnection("user-2", "conn-1", NOW)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(prismaMock.bankConnection.findFirst.mock.calls[0][0].where).toEqual({
      id: "conn-1",
      userId: "user-2",
    });
  });
});

describe("renameConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.bankConnection.findFirst.mockResolvedValue({
      id: "conn-1",
      label: null,
      institutionName: "Banco BPI",
    });
    prismaMock.bankConnection.updateMany.mockResolvedValue({ count: 1 });
  });

  it("names the connection, and records the name it had and the one it has", async () => {
    await expect(renameConnection("user-1", "conn-1", "Conta da casa")).resolves.toEqual({
      connectionId: "conn-1",
      label: "Conta da casa",
    });
    expect(prismaMock.bankConnection.updateMany).toHaveBeenCalledWith({
      where: { id: "conn-1", userId: "user-1" },
      data: { label: "Conta da casa" },
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BANK_CONNECTION_RENAMED",
        resourceId: "conn-1",
        details: { institutionName: "Banco BPI", from: null, to: "Conta da casa" },
      }),
    );
  });

  it("writes and records nothing when the name does not change", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue({
      id: "conn-1",
      label: "Conta da casa",
      institutionName: "Banco BPI",
    });

    await renameConnection("user-1", "conn-1", "Conta da casa");

    expect(prismaMock.bankConnection.updateMany).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the caller, and does not find another owner's connection", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(null);

    await expect(renameConnection("user-2", "conn-1", "Conta")).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(prismaMock.bankConnection.findFirst.mock.calls[0][0].where).toEqual({
      id: "conn-1",
      userId: "user-2",
    });
  });

  it("answers a connection removed meanwhile as not found, and records nothing", async () => {
    prismaMock.bankConnection.updateMany.mockResolvedValue({ count: 0 });

    await expect(renameConnection("user-1", "conn-1", "Conta")).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe("removeConnection", () => {
  let unregister: (() => void) | undefined;
  let fake: FakeProvider;

  function connection(overrides: Record<string, unknown> = {}) {
    return {
      id: "conn-1",
      userId: "user-1",
      provider: "psd2_fake",
      institutionName: "Banco BPI",
      label: "Conta da casa",
      status: "active",
      consentId: "session-1",
      metadata: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    fake = createFakeProvider({ key: "fake" });
    unregister = __registerProviderForTest(fake);
    prismaMock.bankConnection.findFirst.mockResolvedValue(connection());
    prismaMock.bankConnection.deleteMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    unregister?.();
    unregister = undefined;
  });

  it("removes a connection that brought no movements, the condition inside the delete", async () => {
    await expect(removeConnection("user-1", "conn-1")).resolves.toEqual({
      connectionId: "conn-1",
      revocation: "revoked",
    });

    // One statement: a sync landing movements after a separate check could not be deleted with it.
    expect(prismaMock.bankConnection.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "conn-1",
        userId: "user-1",
        accounts: { every: { transactions: { none: {} } } },
      },
    });
    expect(fake.revocations).toEqual(["session-1"]);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BANK_CONNECTION_REMOVED",
        resourceId: "conn-1",
        details: expect.objectContaining({ label: "Conta da casa", revocation: "revoked" }),
      }),
    );
    expect(JSON.stringify(auditMock.mock.calls)).not.toContain("session-1");
  });

  it("refuses one with movements, asks the bank nothing and records nothing", async () => {
    prismaMock.bankConnection.deleteMany.mockResolvedValue({ count: 0 });

    await expect(removeConnection("user-1", "conn-1")).rejects.toMatchObject({
      reason: "bank_connection_has_movements",
    });
    expect(fake.revocations).toEqual([]);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("answers one removed meanwhile, by a second click, as not found", async () => {
    prismaMock.bankConnection.findFirst
      .mockResolvedValueOnce(connection())
      .mockResolvedValueOnce(null);
    prismaMock.bankConnection.deleteMany.mockResolvedValue({ count: 0 });

    await expect(removeConnection("user-1", "conn-1")).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it("removes an empty manual connection, with nothing to ask a bank", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(
      connection({ provider: "manual", consentId: null }),
    );

    await expect(removeConnection("user-1", "conn-1")).resolves.toMatchObject({
      revocation: "no_consent_id",
    });
    expect(fake.revocations).toEqual([]);
  });

  it("scopes the lookup to the caller, and deletes nothing of another owner's", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(null);

    await expect(removeConnection("user-2", "conn-1")).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(prismaMock.bankConnection.findFirst.mock.calls[0][0].where).toEqual({
      id: "conn-1",
      userId: "user-2",
    });
    expect(prismaMock.bankConnection.deleteMany).not.toHaveBeenCalled();
  });
});
