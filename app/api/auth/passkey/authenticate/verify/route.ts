import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

import { rateLimit } from "@/lib/middleware/rate-limit";
import { signMfaProof } from "@/lib/services/auth/mfa-proof";
import { pendingSession } from "@/lib/services/auth/pending-session";
import { openChallenge, passkeySignInLimit, relyingParty } from "@/lib/services/auth/passkey";
import { getPrismaClient } from "@/lib/services/database/database";
import { createErrorResponse, readJson, ValidationError } from "@/lib/utils/error-handling";

const schema = z.object({
  token: z.string().min(1).max(512),
  response: z.object({ id: z.string().min(1).max(1024) }).passthrough(),
});

// POST /api/auth/passkey/authenticate/verify — finish signing in with a passkey
//
// The same job as `totp/verify`, for the same session, with the same answer: a proof made for THIS
// session (`mfa-proof.ts`), which the code page hands to its session through `update({ mfaProof })`.
// A passkey answers a challenge made for this account and this session (`passkey.ts`), so one made
// for another session releases nothing here.
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

    const body = await readJson(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const secret = process.env.NEXTAUTH_SECRET ?? "";
    const challenge = openChallenge(secret, parsed.data.token, {
      kind: "authenticate",
      userId,
      sid,
    });
    if (!challenge) {
      return NextResponse.json(
        { error: "This request has expired; start again", reason: "passkey_challenge_expired" },
        { status: 400 },
      );
    }

    // The passkey is looked up for THIS account: another account's credential id finds nothing.
    const prisma = getPrismaClient();
    const stored = await prisma.passkey.findFirst({
      where: { credentialId: parsed.data.response.id, userId },
    });
    if (!stored) {
      return NextResponse.json(
        { error: "Invalid passkey", reason: "passkey_invalid" },
        { status: 400 },
      );
    }

    // Still on only while the authenticator app is: a passkey is a way past that factor, not a factor.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { totpEnabled: true },
    });
    if (!user?.totpEnabled) {
      return NextResponse.json(
        { error: "Invalid passkey", reason: "passkey_invalid" },
        { status: 400 },
      );
    }

    const { rpID, origin } = relyingParty();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: parsed.data.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: stored.credentialId,
          publicKey: Buffer.from(stored.publicKey, "base64url"),
          counter: stored.counter,
          transports: stored.transports
            ? (JSON.parse(stored.transports) as AuthenticatorTransport[])
            : undefined,
        },
        requireUserVerification: true,
      });
    } catch {
      return NextResponse.json(
        { error: "Invalid passkey", reason: "passkey_invalid" },
        { status: 400 },
      );
    }
    if (!verification.verified) {
      return NextResponse.json(
        { error: "Invalid passkey", reason: "passkey_invalid" },
        { status: 400 },
      );
    }

    // The count only ever goes forward: a passkey that reports a lower one than it did is a copy.
    // (A synced passkey reports 0 every time, which the library accepts.)
    const { newCounter } = verification.authenticationInfo;
    await prisma.passkey.update({
      where: { id: stored.id },
      data: { counter: newCounter, lastUsedAt: new Date() },
    });
    await prisma.user.update({ where: { id: userId }, data: { totpVerifiedAt: new Date() } });

    return NextResponse.json({ ok: true, proof: signMfaProof(secret, { userId, sid }) });
  } catch (err) {
    if (err instanceof ValidationError) return createErrorResponse(err, 400, request);
    console.error("Passkey authenticate verify error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
