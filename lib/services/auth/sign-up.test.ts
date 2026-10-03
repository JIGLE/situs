import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * How `updateSignUpSettings` writes, with the database mocked. The real-SQLite cases are
 * `sign-up.integration.test.ts`; this pins what a file cannot show: which columns a change names.
 *
 * Two administrators changing different switches at once is a race a single connection cannot make
 * happen on demand, so the property is asserted on the query itself.
 */

const { prismaMock, logAuditMock } = vi.hoisted(() => ({
  prismaMock: { instanceSettings: { findUnique: vi.fn(), upsert: vi.fn() } },
  logAuditMock: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));

import { updateSignUpSettings } from "./sign-up";

const store = (row: { googleSignUp: boolean; invitations: boolean } | null) =>
  prismaMock.instanceSettings.findUnique.mockResolvedValue(row);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.instanceSettings.upsert.mockImplementation(async ({ update }: { update: object }) => ({
    googleSignUp: true,
    invitations: true,
    ...update,
  }));
});

describe("updateSignUpSettings", () => {
  it("writes only the switch it was asked to change", async () => {
    store({ googleSignUp: true, invitations: true });

    await updateSignUpSettings("admin-1", { googleSignUp: false });

    const { update } = prismaMock.instanceSettings.upsert.mock.calls[0][0];
    // No `invitations` key: another administrator's change to it, made since this one read, stays.
    expect(update).toEqual({ googleSignUp: false, updatedById: "admin-1" });
  });

  it("fills in the switch it was not asked about only when it creates the row", async () => {
    store(null);

    await updateSignUpSettings("admin-1", { invitations: false });

    const { create } = prismaMock.instanceSettings.upsert.mock.calls[0][0];
    // The defaults stand for what was never saved: Google sign-up off, invitations changed.
    expect(create).toEqual({
      id: "instance",
      googleSignUp: false,
      invitations: false,
      updatedById: "admin-1",
    });
  });

  it("answers the settings as stored, not as they were read", async () => {
    store({ googleSignUp: true, invitations: true });
    // Another administrator closed invitations between this read and this write.
    prismaMock.instanceSettings.upsert.mockResolvedValue({
      googleSignUp: false,
      invitations: false,
    });

    await expect(updateSignUpSettings("admin-1", { googleSignUp: false })).resolves.toEqual({
      googleSignUp: false,
      invitations: false,
    });
  });

  it("audits the switches named whose value changes, and no other", async () => {
    store({ googleSignUp: true, invitations: true });

    await updateSignUpSettings("admin-1", { googleSignUp: false, invitations: true });

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-1",
        action: "SIGN_UP_SETTING_CHANGE",
        details: { setting: "googleSignUp", from: true, to: false },
      }),
    );
  });
});
