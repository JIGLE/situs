import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The hole these cases exist for, stated once so it cannot be re-opened by accident:
 *
 * The OAuth `signIn` callback ended in an unconditional `return true`, and the JWT callback
 * provisioned every new identity with `role: "ADMIN"`. A publicly reachable instance — which a
 * live bank connection requires, since the provider must reach the consent callback — handed an
 * administrator account to anyone who clicked "Sign in with Google".
 *
 * `decideSignIn` is pure so the policy can be enumerated exhaustively here without a database.
 * `resolveSignIn` is the thin part that reads one; its only interesting property is that it fails
 * closed, which is the case a mocked Prisma can prove and a live one cannot.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), count: vi.fn() },
    instanceSettings: { findUnique: vi.fn() },
    accessInvitation: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { allowedEmails, decideSignIn, provisionAccount, resolveSignIn } from "./registration";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AUTH_ALLOWED_EMAILS;
});

afterEach(() => {
  delete process.env.AUTH_ALLOWED_EMAILS;
});

describe("the registration policy", () => {
  const base = { email: "someone@example.org", allowed: [] as string[] };

  it("lets an existing user sign in, as it always did", () => {
    // The common case by far, and the one that must never regress: locking registration must not
    // lock out the person who already owns the instance.
    expect(decideSignIn({ ...base, userExists: true, totalUsers: 1 })).toEqual({
      allow: true,
      reason: "existing_user",
    });
  });

  it("admits the very first account, so a fresh install can be claimed", () => {
    // Bootstrap needs no configuration — requiring an env var to create the first account would
    // mean an operator locked out of a brand-new instance with no way in.
    expect(decideSignIn({ ...base, userExists: false, totalUsers: 0 })).toEqual({
      allow: true,
      reason: "bootstrap",
      role: "ADMIN",
    });
  });

  it("REFUSES a stranger once an account exists", () => {
    // The whole point. Revert the gate in auth.ts and this is the assertion that goes red.
    expect(decideSignIn({ ...base, userExists: false, totalUsers: 1 })).toEqual({
      allow: false,
      reason: "registration_closed",
    });
  });

  it("admits an explicitly allowlisted email", () => {
    expect(
      decideSignIn({
        email: "partner@example.org",
        userExists: false,
        totalUsers: 1,
        allowed: ["partner@example.org"],
      }),
    ).toEqual({ allow: true, reason: "allowlisted", role: "ADMIN" });
  });

  it("matches the allowlist case-insensitively and ignores stray spacing", () => {
    // Emails are not case-sensitive in practice, and a value pasted into a config field arrives
    // with whatever whitespace came with it. Neither should silently deny a legitimate person.
    process.env.AUTH_ALLOWED_EMAILS = " Partner@Example.ORG , second@example.org ";
    expect(allowedEmails()).toEqual(["partner@example.org", "second@example.org"]);

    expect(
      decideSignIn({
        email: "  PARTNER@example.org ",
        userExists: false,
        totalUsers: 3,
        allowed: allowedEmails(),
      }).allow,
    ).toBe(true);
  });

  it("treats an unset or blank allowlist as nobody extra, not everybody", () => {
    // A split on "" yields [""], which would match an empty email. Worth pinning: the failure
    // would be silent and would open the instance rather than close it.
    expect(allowedEmails()).toEqual([]);
    process.env.AUTH_ALLOWED_EMAILS = "   ,  ,";
    expect(allowedEmails()).toEqual([]);
  });
});

describe("the two sign-up switches and the invitations", () => {
  const stranger = {
    email: "newcomer@example.org",
    userExists: false,
    totalUsers: 2,
    allowed: [],
    emailVerified: true,
  };
  const on = { googleSignUp: true, invitations: true };
  const off = { googleSignUp: false, invitations: false };
  const invitedAs = (role: "ADMIN" | "MANAGER") => ({ id: "inv-1", role });

  it.each(["ADMIN", "MANAGER"] as const)(
    "admits an invited email as the %s it was invited as, while the invitations switch is on",
    (role) => {
      expect(
        decideSignIn({
          ...stranger,
          provider: "google",
          settings: { googleSignUp: false, invitations: true },
          invitation: invitedAs(role),
        }),
      ).toEqual({ allow: true, reason: "invited", role, invitationId: "inv-1" });
    },
  );

  it("does not admit an invited email while the invitations switch is off", () => {
    expect(
      decideSignIn({
        ...stranger,
        provider: "google",
        settings: { googleSignUp: false, invitations: false },
        invitation: invitedAs("ADMIN"),
      }),
    ).toEqual({ allow: false, reason: "registration_closed" });
  });

  it("admits any Google account as a manager while Google sign-up is on", () => {
    expect(
      decideSignIn({
        ...stranger,
        provider: "google",
        settings: { googleSignUp: true, invitations: false },
      }),
    ).toEqual({ allow: true, reason: "open_google", role: "MANAGER" });
  });

  it("opens Google sign-up to Google and to nothing else", () => {
    for (const provider of [undefined, "github", "credentials"]) {
      expect(decideSignIn({ ...stranger, provider, settings: on })).toEqual({
        allow: false,
        reason: "registration_closed",
      });
    }
  });

  it("keeps a stranger out when both switches are off, whatever is invited", () => {
    expect(
      decideSignIn({
        ...stranger,
        provider: "google",
        settings: off,
        invitation: invitedAs("ADMIN"),
      }),
    ).toEqual({ allow: false, reason: "registration_closed" });
  });

  it("lets an invitation outrank open sign-up: invited as an administrator is one", () => {
    expect(
      decideSignIn({
        ...stranger,
        provider: "google",
        settings: on,
        invitation: invitedAs("ADMIN"),
      }),
    ).toEqual({ allow: true, reason: "invited", role: "ADMIN", invitationId: "inv-1" });
  });

  it("closes both doors when the settings could not be read, or were never given", () => {
    // An unreadable setting never opens one. `null` is what `readSignUpSettings` answers on a failure.
    for (const settings of [null, undefined]) {
      expect(
        decideSignIn({
          ...stranger,
          provider: "google",
          settings,
          invitation: invitedAs("MANAGER"),
        }),
      ).toEqual({ allow: false, reason: "registration_closed" });
    }
  });

  it("never lets a setting stand between an existing account and its sign-in", () => {
    for (const settings of [off, null, undefined]) {
      expect(decideSignIn({ ...stranger, userExists: true, provider: "google", settings })).toEqual(
        { allow: true, reason: "existing_user" },
      );
    }
  });

  it("never lets a setting stand between the first account, or the allowlist, and the instance", () => {
    expect(
      decideSignIn({ ...stranger, totalUsers: 0, provider: "google", settings: null }),
    ).toEqual({ allow: true, reason: "bootstrap", role: "ADMIN" });
    expect(
      decideSignIn({ ...stranger, allowed: [stranger.email], provider: "google", settings: null }),
    ).toEqual({ allow: true, reason: "allowlisted", role: "ADMIN" });
  });

  describe("the email the provider has not verified", () => {
    type Input = Parameters<typeof decideSignIn>[0];
    const unverified = { ...stranger, provider: "google", emailVerified: false };
    const closed = { allow: false, reason: "registration_closed" };
    const doors: [string, Partial<Input>][] = [
      [
        "an invitation",
        { settings: { googleSignUp: false, invitations: true }, invitation: invitedAs("MANAGER") },
      ],
      ["open Google sign-up", { settings: { googleSignUp: true, invitations: false } }],
    ];

    it.each(doors)(
      "is refused, and said to be, where %s would have admitted the identity",
      (_door, doorOpen) => {
        // `false` is the provider saying no; undefined is it saying nothing, which counts the same.
        for (const emailVerified of [false, undefined]) {
          expect(decideSignIn({ ...unverified, ...doorOpen, emailVerified })).toEqual({
            allow: false,
            reason: "email_unverified",
          });
        }
      },
    );

    it("is just closed when no door was open for the identity anyway", () => {
      // Both switches off, an invitation or not.
      expect(
        decideSignIn({ ...unverified, settings: off, invitation: invitedAs("ADMIN") }),
      ).toEqual(closed);
      // The invitations switch on, nobody invited, Google sign-up off.
      expect(
        decideSignIn({ ...unverified, settings: { googleSignUp: false, invitations: true } }),
      ).toEqual(closed);
      // Google sign-up is Google's alone.
      expect(
        decideSignIn({
          ...unverified,
          provider: "github",
          settings: { googleSignUp: true, invitations: false },
        }),
      ).toEqual(closed);
    });

    it("is not asked about for an existing account, the first account or an allowlisted email", () => {
      const open = { ...unverified, settings: on, invitation: invitedAs("ADMIN") };

      expect(decideSignIn({ ...open, userExists: true })).toEqual({
        allow: true,
        reason: "existing_user",
      });
      expect(decideSignIn({ ...open, totalUsers: 0 })).toEqual({
        allow: true,
        reason: "bootstrap",
        role: "ADMIN",
      });
      expect(decideSignIn({ ...open, allowed: [stranger.email] })).toEqual({
        allow: true,
        reason: "allowlisted",
        role: "ADMIN",
      });
    });
  });
});

describe("resolving the policy against the database", () => {
  it("refuses when the database cannot be read", async () => {
    // Fails CLOSED. An outage must not become an unauthenticated-signup window — which is exactly
    // what a `catch { return true }` here would produce, and it would never be noticed.
    prismaMock.user.findUnique.mockRejectedValue(new Error("database is locked"));
    prismaMock.user.count.mockRejectedValue(new Error("database is locked"));

    await expect(resolveSignIn("someone@example.org")).rejects.toThrow();
  });

  it("reads both the user and the total, and admits the owner", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });
    prismaMock.user.count.mockResolvedValue(1);

    await expect(resolveSignIn("owner@example.org")).resolves.toEqual({
      allow: true,
      reason: "existing_user",
    });
  });

  it("refuses an unknown email on a claimed instance", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.count.mockResolvedValue(1);

    await expect(resolveSignIn("stranger@example.org")).resolves.toEqual({
      allow: false,
      reason: "registration_closed",
    });
  });
});

describe("resolving a new account against the settings and invitations", () => {
  const stranger = "newcomer@example.org";

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.instanceSettings.findUnique.mockResolvedValue({
      googleSignUp: false,
      invitations: true,
    });
    prismaMock.accessInvitation.findFirst.mockResolvedValue(null);
  });

  const neverRead = () => {
    expect(prismaMock.instanceSettings.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.accessInvitation.findFirst).not.toHaveBeenCalled();
  };

  it("reads neither for an existing account", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });

    await resolveSignIn("owner@example.org", "google");

    neverRead();
  });

  it("reads neither for the first account", async () => {
    prismaMock.user.count.mockResolvedValue(0);

    await resolveSignIn(stranger, "google");

    neverRead();
  });

  it("reads neither for an allowlisted email", async () => {
    process.env.AUTH_ALLOWED_EMAILS = stranger;

    await expect(resolveSignIn(stranger, "google")).resolves.toMatchObject({
      reason: "allowlisted",
    });

    neverRead();
  });

  it("admits an invited email as the role its live invitation carries", async () => {
    prismaMock.accessInvitation.findFirst.mockResolvedValue({ id: "inv-9", role: "MANAGER" });

    await expect(resolveSignIn("Newcomer@Example.org ", "google", true)).resolves.toEqual({
      allow: true,
      reason: "invited",
      role: "MANAGER",
      invitationId: "inv-9",
    });
    // Looked up lower-case, and only among the invitations that have not lapsed.
    expect(prismaMock.accessInvitation.findFirst).toHaveBeenCalledWith({
      where: { email: stranger, expiresAt: { gt: expect.any(Date) } },
      select: { id: true, role: true },
    });
  });

  it("admits a Google account as a manager when Google sign-up is on", async () => {
    prismaMock.instanceSettings.findUnique.mockResolvedValue({
      googleSignUp: true,
      invitations: true,
    });

    await expect(resolveSignIn(stranger, "google", true)).resolves.toEqual({
      allow: true,
      reason: "open_google",
      role: "MANAGER",
    });
  });

  it("refuses an invitation and Google sign-up alike for an email the provider has not verified", async () => {
    // An invitation is held for this address, and the invitations switch is on.
    prismaMock.accessInvitation.findFirst.mockResolvedValue({ id: "inv-9", role: "ADMIN" });
    for (const emailVerified of [false, undefined]) {
      await expect(resolveSignIn(stranger, "google", emailVerified)).resolves.toEqual({
        allow: false,
        reason: "email_unverified",
      });
    }

    // Open Google sign-up, with nobody invited.
    prismaMock.accessInvitation.findFirst.mockResolvedValue(null);
    prismaMock.instanceSettings.findUnique.mockResolvedValue({
      googleSignUp: true,
      invitations: false,
    });
    await expect(resolveSignIn(stranger, "google", false)).resolves.toEqual({
      allow: false,
      reason: "email_unverified",
    });
  });

  it("uses the defaults when nothing was ever saved: closed to Google, open to invitations", async () => {
    prismaMock.instanceSettings.findUnique.mockResolvedValue(null);
    prismaMock.accessInvitation.findFirst.mockResolvedValue({ id: "inv-1", role: "ADMIN" });

    await expect(resolveSignIn(stranger, "google", true)).resolves.toMatchObject({
      reason: "invited",
    });
    prismaMock.accessInvitation.findFirst.mockResolvedValue(null);
    await expect(resolveSignIn(stranger, "google", true)).resolves.toEqual({
      allow: false,
      reason: "registration_closed",
    });
  });

  it("closes the new-account doors when the settings cannot be read, and only those", async () => {
    prismaMock.instanceSettings.findUnique.mockRejectedValue(new Error("no such table"));
    prismaMock.accessInvitation.findFirst.mockResolvedValue({ id: "inv-1", role: "ADMIN" });

    await expect(resolveSignIn(stranger, "google", true)).resolves.toEqual({
      allow: false,
      reason: "registration_closed",
    });

    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });
    await expect(resolveSignIn("owner@example.org", "google")).resolves.toEqual({
      allow: true,
      reason: "existing_user",
    });
  });

  it("finds no invitation when the invitations cannot be read", async () => {
    prismaMock.accessInvitation.findFirst.mockRejectedValue(new Error("database is locked"));

    await expect(resolveSignIn(stranger, "google", true)).resolves.toEqual({
      allow: false,
      reason: "registration_closed",
    });
  });

  it("does not honour an invitation holding a role it does not know", async () => {
    prismaMock.accessInvitation.findFirst.mockResolvedValue({ id: "inv-1", role: "USER" });

    await expect(resolveSignIn(stranger, "google", true)).resolves.toEqual({
      allow: false,
      reason: "registration_closed",
    });
  });
});

describe("provisioning an account when another sign-in is first", () => {
  const sameEmail = { email: "twin@example.org", provider: "google", emailVerified: true };

  beforeEach(() => {
    prismaMock.user.count.mockResolvedValue(2);
  });

  it("returns the account that appeared between the first look and the decision, and makes none", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null) // provisionAccount's own look: nobody
      .mockResolvedValueOnce({ id: "user-7" }) // the gate's look: the other sign-in's row is there
      .mockResolvedValueOnce({ id: "user-7", role: "MANAGER" }); // read again for its role

    await expect(provisionAccount(sameEmail)).resolves.toEqual({ id: "user-7", role: "MANAGER" });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("refuses when the gate says the account exists but it cannot be found again", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "user-7" })
      .mockResolvedValueOnce(null);

    await expect(provisionAccount(sameEmail)).rejects.toThrow("REGISTRATION_CLOSED");

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
