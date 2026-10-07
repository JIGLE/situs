import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * What Admin says of registration is derived from the accounts, the two sign-up switches and the
 * invitations still live. A screen that says "closed" while Google sign-up is on is a lie, and the
 * state has to be read, not remembered (the `bankCheck` rule).
 */

const { prismaMock, signUp } = vi.hoisted(() => ({
  prismaMock: { user: { count: vi.fn() } },
  signUp: { readSignUpSettings: vi.fn(), countLiveInvitations: vi.fn() },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/auth/sign-up", () => signUp);

import { getSignInStatus } from "./sign-in-status";

/** An instance with `total` accounts, `admins` of them administrators. */
const accounts = (total: number, admins = Math.min(total, 1)) => {
  prismaMock.user.count.mockImplementation(async (args?: { where?: { role?: string } }) =>
    args?.where?.role === "ADMIN" ? admins : total,
  );
};
const switches = (googleSignUp: boolean, invitations: boolean) =>
  signUp.readSignUpSettings.mockResolvedValue({ googleSignUp, invitations });

beforeEach(() => {
  vi.resetAllMocks();
  accounts(2);
  switches(false, true);
  signUp.countLiveInvitations.mockResolvedValue(0);
  delete process.env.AUTH_ALLOWED_EMAILS;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("registration", () => {
  it("is open for the first sign-in when no account exists, whatever else is set", async () => {
    accounts(0);
    switches(true, true);
    signUp.countLiveInvitations.mockResolvedValue(3);

    expect((await getSignInStatus()).registration).toBe("open_bootstrap");
  });

  it("is closed on a claimed instance with the defaults and nobody invited", async () => {
    // Invitations are on by default, but with none sent they admit nobody.
    expect(await getSignInStatus()).toMatchObject({
      registration: "closed",
      pendingInvitations: 0,
    });
  });

  it("is by invitation while one is live and the invitations switch is on", async () => {
    signUp.countLiveInvitations.mockResolvedValue(2);

    expect(await getSignInStatus()).toMatchObject({
      registration: "invitations",
      pendingInvitations: 2,
    });
  });

  it("is closed, though invitations are held, while the invitations switch is off", async () => {
    switches(false, false);
    signUp.countLiveInvitations.mockResolvedValue(2);

    expect(await getSignInStatus()).toMatchObject({
      registration: "closed",
      pendingInvitations: 2,
    });
  });

  it("is open to any Google account while Google sign-up is on, invited or not", async () => {
    switches(true, true);
    signUp.countLiveInvitations.mockResolvedValue(1);

    expect((await getSignInStatus()).registration).toBe("google");
    switches(true, false);
    expect((await getSignInStatus()).registration).toBe("google");
  });

  it("is closed when the switches cannot be read, whatever is invited", async () => {
    signUp.readSignUpSettings.mockResolvedValue(null);
    signUp.countLiveInvitations.mockResolvedValue(2);

    expect((await getSignInStatus()).registration).toBe("closed");
  });
});

describe("the rest of the status", () => {
  it("counts the accounts and the administrators among them", async () => {
    accounts(5, 2);

    expect(await getSignInStatus()).toMatchObject({ totalAccounts: 5, adminAccounts: 2 });
  });

  it("lists the allowlist, and says Google is configured only when both its variables are set", async () => {
    process.env.AUTH_ALLOWED_EMAILS = "Partner@Example.org";
    expect((await getSignInStatus()).allowlist).toEqual(["partner@example.org"]);
    expect((await getSignInStatus()).providers).toEqual([
      { key: "credentials", configured: true },
      { key: "google", configured: false },
    ]);

    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    expect((await getSignInStatus()).providers[1]).toEqual({ key: "google", configured: true });
  });
});
