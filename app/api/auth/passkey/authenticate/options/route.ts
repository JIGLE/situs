import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";

import { rateLimit } from "@/lib/middleware/rate-limit";
import { pendingSession } from "@/lib/services/auth/pending-session";
import { passkeySignInLimit, relyingParty, signChallenge } from "@/lib/services/auth/passkey";
import { getPrismaClient } from "@/lib/services/database/database";

// POST /api/auth/passkey/authenticate/options — start signing in with a passkey
//
// For the session that has passed its first factor and is waiting for the second (`mfaPending`), the
// one the code page serves: it names the account's passkeys and a challenge made for this session.
// It holds nothing a second factor protects, which is why it needs no CSRF token (see
// `csrf-check.test.ts`); the answer that releases a session is `authenticate/verify`.
export async function POST(request: NextRequest) {
  const pending = await pendingSession(request);
  if (!pending.ok) {
    return NextResponse.json(
      { error: pending.error, ...(pending.reason ? { reason: pending.reason } : {}) },
      { status: pending.status },
    );
  }
  const { userId, sid } = pending;

  try {
    const limited = await rateLimit(request, passkeySignInLimit(userId));
    if (limited) return limited;

    const passkeys = await getPrismaClient().passkey.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });
    if (passkeys.length === 0) {
      return NextResponse.json(
        { error: "No passkey on this account", reason: "no_passkey" },
        { status: 404 },
      );
    }

    const options = await generateAuthenticationOptions({
      rpID: relyingParty().rpID,
      allowCredentials: passkeys.map((p) => ({
        id: p.credentialId,
        transports: parseTransports(p.transports),
      })),
      userVerification: "required",
    });

    return NextResponse.json({
      options,
      token: signChallenge(
        process.env.NEXTAUTH_SECRET ?? "",
        { kind: "authenticate", userId, sid },
        options.challenge,
      ),
    });
  } catch (err) {
    console.error("Passkey authenticate options error", err);
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
