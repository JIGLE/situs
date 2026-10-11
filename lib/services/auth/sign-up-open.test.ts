import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What the sign-in page may offer a visitor with no account. Closed is the answer to everything
 * unreadable, so a broken database never makes the page invite strangers in.
 */
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { user: { count: vi.fn() }, instanceSettings: { findUnique: vi.fn() } },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: vi.fn() }));

import { isSignUpOpen } from "./sign-up";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isSignUpOpen", () => {
  it("is open on a first run, when the first account becomes the administrator", async () => {
    prismaMock.user.count.mockResolvedValue(0);

    expect(await isSignUpOpen()).toBe(true);
    expect(prismaMock.instanceSettings.findUnique).not.toHaveBeenCalled();
  });

  it("is closed once there is an account and nothing was opened", async () => {
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.instanceSettings.findUnique.mockResolvedValue(null);

    expect(await isSignUpOpen()).toBe(false);
  });

  it("is open when the Google sign-up switch is on", async () => {
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.instanceSettings.findUnique.mockResolvedValue({
      googleSignUp: true,
      invitations: true,
    });

    expect(await isSignUpOpen()).toBe(true);
  });

  it("does not count invitations: they admit one named email through the same button", async () => {
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.instanceSettings.findUnique.mockResolvedValue({
      googleSignUp: false,
      invitations: true,
    });

    expect(await isSignUpOpen()).toBe(false);
  });

  it("is closed when the accounts cannot be counted", async () => {
    prismaMock.user.count.mockRejectedValue(new Error("database is locked"));

    expect(await isSignUpOpen()).toBe(false);
  });

  it("is closed when the switches cannot be read", async () => {
    prismaMock.user.count.mockResolvedValue(3);
    prismaMock.instanceSettings.findUnique.mockRejectedValue(new Error("database is locked"));

    expect(await isSignUpOpen()).toBe(false);
  });
});
