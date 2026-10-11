import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

import { csrfProtection } from "@/lib/middleware/csrf";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import {
  MAX_PASSKEYS,
  cleanName,
  openChallenge,
  relyingParty,
  summarize,
} from "@/lib/services/auth/passkey";
import { getPrismaClient } from "@/lib/services/database/database";
import { createErrorResponse, readJson, ValidationError } from "@/lib/utils/error-handling";

const schema = z.object({
  token: z.string().min(1).max(512),
  name: z.string().max(200).optional(),
  response: z.object({ id: z.string().min(1).max(1024) }).passthrough(),
});

// POST /api/auth/passkey/register/verify — finish saving a passkey
//
// Checks its own CSRF token: /api/auth/** is public in proxy.ts, so the proxy checks none here.
//
// The code was checked when the ceremony started (`register/options`); what proves it here is the
// signed challenge that route handed out, made for this account and this kind of ceremony, and the
// authenticator's answer to it. Only the public key is kept.
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const csrfError = await csrfProtection(request);
  if (csrfError) return csrfError;

  const { userId } = authResult;

  try {
    const body = await readJson(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const challenge = openChallenge(process.env.NEXTAUTH_SECRET, parsed.data.token, {
      kind: "register",
      userId,
    });
    if (!challenge) {
      return NextResponse.json(
        { error: "This request has expired; start again", reason: "passkey_challenge_expired" },
        { status: 400 },
      );
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { totpEnabled: true, _count: { select: { passkeys: true } } },
    });
    if (!user?.totpEnabled) {
      return NextResponse.json(
        { error: "Turn on the authenticator app first", reason: "totp_required" },
        { status: 409 },
      );
    }
    if (user._count.passkeys >= MAX_PASSKEYS) {
      return NextResponse.json(
        { error: "Too many passkeys", reason: "passkey_limit" },
        { status: 409 },
      );
    }

    const { rpID, origin } = relyingParty();
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: parsed.data.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch {
      // The authenticator's answer did not hold up: wrong site, wrong challenge, no user verification.
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

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const transports = (parsed.data.response as { response?: { transports?: unknown } }).response
      ?.transports;

    const exists = await prisma.passkey.findUnique({
      where: { credentialId: credential.id },
      select: { id: true },
    });
    if (exists) {
      return NextResponse.json(
        { error: "This passkey is already saved", reason: "passkey_exists" },
        { status: 409 },
      );
    }

    let created;
    try {
      created = await prisma.passkey.create({
        data: {
          userId,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString("base64url"),
          counter: credential.counter,
          transports: Array.isArray(transports) ? JSON.stringify(transports) : null,
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          name: cleanName(parsed.data.name, "Passkey"),
        },
        select: { id: true, name: true, createdAt: true, lastUsedAt: true, deviceType: true },
      });
    } catch (err) {
      // The same credential finished twice at once: both passed the check above, one created it.
      if ((err as { code?: string } | null)?.code === "P2002") {
        return NextResponse.json(
          { error: "This passkey is already saved", reason: "passkey_exists" },
          { status: 409 },
        );
      }
      throw err;
    }

    return NextResponse.json({ passkey: summarize(created) });
  } catch (err) {
    if (err instanceof ValidationError) return createErrorResponse(err, 400, request);
    console.error("Passkey register verify error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
