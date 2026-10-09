import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfProtection } from "@/lib/middleware/csrf";
import { rateLimit } from "@/lib/middleware/rate-limit";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { totpGuessLimit } from "@/lib/services/auth/totp-guess-limit";
import { signKeepProof } from "@/lib/services/auth/session-keep-proof";
import { rememberSessionsValidFrom } from "@/lib/services/auth/session-epoch";
import { getPrismaClient } from "@/lib/services/database/database";
import { createErrorResponse, readJson, ValidationError } from "@/lib/utils/error-handling";
import { encryptPII, decryptPII } from "@/lib/utils/pii-encryption";
import { totpVerify } from "@/lib/utils/totp";
import crypto from "crypto";

const schema = z.object({ code: z.string().length(6) });

function generateBackupCodes(): string[] {
  return Array.from({ length: 10 }, () => crypto.randomBytes(4).toString("hex").toUpperCase());
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// POST /api/auth/totp/enable — verify code and enable TOTP; returns backup codes
//
// Checks its own CSRF token: /api/auth/** is public in proxy.ts, so the proxy checks none here.
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const csrfError = await csrfProtection(request);
  if (csrfError) return csrfError;

  const { userId, session } = authResult;

  try {
    const body = await readJson(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret) {
      return NextResponse.json({ error: "TOTP not set up" }, { status: 400 });
    }

    // A factor that is on is changed by `disable`, never confirmed again from here. A hit on the
    // code below turns the factor on, hands back backup codes and ends every other session, so a
    // stolen session could otherwise guess it on an account that already has one.
    if (user.totpEnabled) {
      return NextResponse.json(
        { error: "Two-factor authentication is already on", reason: "totp_already_enabled" },
        { status: 409 },
      );
    }

    // The same per-account budget as `verify` and `disable`: this is not a third place to try six
    // digits.
    const limited = await rateLimit(request, totpGuessLimit(userId));
    if (limited) return limited;

    const secret = decryptPII(user.totpSecret);
    const isValid = totpVerify(parsed.data.code, secret);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    const backupCodes = generateBackupCodes();
    const hashedCodes = backupCodes.map(hashCode);

    // Turned on only for the secret the code was just checked against. A `disable` or a new `setup`
    // that landed since the read has changed it, and turning the factor on then would leave it on
    // with no secret, or with one that was never confirmed.
    //
    // Every session signed in before this moment ends with it (`session-epoch.ts`): a password or a
    // cookie that was already out stops working when the second factor is added. The same update
    // stamps the account, so there is no instant with the factor on and the old sessions alive.
    const validFrom = new Date();
    const stored = await prisma.user.updateMany({
      where: { id: userId, totpEnabled: false, totpSecret: user.totpSecret },
      data: {
        totpEnabled: true,
        sessionsValidFrom: validFrom,
        totpBackupCodes: encryptPII(JSON.stringify(hashedCodes)),
      },
    });
    if (stored.count === 0) {
      return NextResponse.json(
        { error: "Two-factor setup changed; start again", reason: "totp_setup_changed" },
        { status: 409 },
      );
    }

    rememberSessionsValidFrom(userId, validFrom);

    // This session is the owner's own, so it carries on: the proof renews its sign-in time when the
    // browser hands it back (`update({ keepProof })`). Without one the session ends with the rest.
    const serverSecret = process.env.NEXTAUTH_SECRET;
    const signedAt = (session as { signedAt?: unknown }).signedAt;
    const keepProof = serverSecret
      ? signKeepProof(serverSecret, {
          userId,
          signedAt: typeof signedAt === "number" ? signedAt : 0,
        })
      : undefined;

    return NextResponse.json({ backupCodes, keepProof });
  } catch (err) {
    if (err instanceof ValidationError) return createErrorResponse(err, 400, request);
    console.error("TOTP enable error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
