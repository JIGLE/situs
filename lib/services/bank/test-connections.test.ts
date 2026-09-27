import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, auditMock, revokeMock } = vi.hoisted(() => ({
  prismaMock: { bankConnection: { findFirst: vi.fn(), delete: vi.fn() } },
  auditMock: vi.fn(),
  revokeMock: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: auditMock }));
vi.mock("@/lib/services/bank/connections", () => ({ revokeAtBank: revokeMock }));

import { deleteTestConnection } from "./test-connections";

function testRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    userId: "user-1",
    provider: "psd2_fake",
    institutionName: "Mock ASPSP",
    consentId: "session-1",
    metadata: JSON.stringify({ isTest: true }),
    accounts: [{ id: "acct-1", _count: { transactions: 3 } }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.bankConnection.findFirst.mockResolvedValue(testRun());
  prismaMock.bankConnection.delete.mockResolvedValue({});
  revokeMock.mockResolvedValue("revoked");
});

describe("deleteTestConnection", () => {
  it("deletes a test run, then ends its consent at the bank", async () => {
    await expect(deleteTestConnection("user-1", "conn-1")).resolves.toEqual({
      accounts: 1,
      movements: 3,
    });

    expect(prismaMock.bankConnection.delete).toHaveBeenCalledWith({ where: { id: "conn-1" } });
    expect(revokeMock).toHaveBeenCalledWith("psd2_fake", "session-1");
    expect(revokeMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      prismaMock.bankConnection.delete.mock.invocationCallOrder[0],
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BANK_CONNECTION_DELETED",
        details: expect.objectContaining({ isTest: true, revocation: "revoked" }),
      }),
    );
    expect(JSON.stringify(auditMock.mock.calls)).not.toContain("session-1");
  });

  it("refuses a real connection, and asks the bank nothing", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(testRun({ metadata: null }));

    await expect(deleteTestConnection("user-1", "conn-1")).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.bankConnection.delete).not.toHaveBeenCalled();
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("does not find another owner's connection", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(null);

    await expect(deleteTestConnection("user-2", "conn-1")).rejects.toMatchObject({ status: 404 });
    expect(prismaMock.bankConnection.findFirst.mock.calls[0][0].where).toEqual({
      id: "conn-1",
      userId: "user-2",
    });
  });
});
