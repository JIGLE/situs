import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateRegistrationOptions } from "@simplewebauthn/server";

import { csrfProtection } from "@/lib/middleware/csrf";
import { rateLimit } from "@/lib/middleware/rate-limit";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { MAX_PASSKEYS, RP_NAME, relyingParty, signChallenge } from "@/lib/services/auth/passkey";
import { provesSecondFactor } from "@/lib/services/auth/second-factor-code";
import { totpGuessLimit } from "@/lib/services/auth/totp-guess-limit";
import { getPrismaClient } from "@/lib/services/database/database";
import { createErrorResponse, readJson, ValidationError } from "@/lib/utils/error-handling";

const schema = z.object({ code: z.string().min(6).max(8) });

// POST /api/auth/passkey/register/options — start saving a passkey
//
// Checks its own CSRF token: /api/auth/** is public in proxy.ts, so the proxy checks none here.
//
// Adding a way in takes a code from the factor that is already there, an authenticator code or a
// backup code, for the reason turning the factor off does (`totp/disable`): the session that asks
// may be one someone else is holding, and a passkey they saved would stay after the cookie was gone.
// Guesses share the account's one budget (`totpGuessLimit`). Only an account that has the
// authenticator app on can add one: the app is what a lost passkey falls back to.
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const csrfError = await csrfProtection(request);
  if (csrfError) return csrfError;

  const { userId } = authResult;

  try {
    const limited = await rateLimit(request, totpGuessLimit(userId));
    if (limited) return limited;

    const body = await readJson(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        name: true,
        totpEnabled: true,
        totpSecret: true,
        totpBackupCodes: true,
        passkeys: { select: { credentialId: true, transports: true } },
      },
    });
    if (!user?.totpEnabled) {
      return NextResponse.json(
        { error: "Turn on the authenticator app first", reason: "totp_required" },
        { status: 409 },
      );
    }
    if (user.passkeys.length >= MAX_PASSKEYS) {
      return NextResponse.json(
        { error: "Too many passkeys", reason: "passkey_limit" },
        { status: 409 },
      );
    }
    if (!provesSecondFactor(user, parsed.data.code)) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    const secret = process.env.NEXTAUTH_SECRET ?? "";
    const { rpID } = relyingParty();
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: user.email,
      userDisplayName: user.name ?? user.email,
      attestationType: "none",
      // One passkey per device: the authenticator is told which it already holds.
      excludeCredentials: user.passkeys.map((p) => ({
        id: p.credentialId,
        transports: parseTransports(p.transports),
      })),
      // A second factor must be a person, not just a device: the phone's fingerprint, face or lock.
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });

    return NextResponse.json({
      options,
      token: signChallenge(secret, { kind: "register", userId }, options.challenge),
    });
  } catch (err) {
    if (err instanceof ValidationError) return createErrorResponse(err, 400, request);
    console.error("Passkey register options error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function parseTransports(value: string | null): AuthenticatorTransport[] | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as AuthenticatorTransport[]) : undefined;
  } catch {
    return undefined;
  }
}
