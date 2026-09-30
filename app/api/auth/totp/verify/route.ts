import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/lib/services/auth/auth";
import { getPrismaClient } from "@/lib/services/database/database";
import { createErrorResponse, readJson, ValidationError } from "@/lib/utils/error-handling";
import { decryptPII, encryptPII } from "@/lib/utils/pii-encryption";
import { totpVerify } from "@/lib/utils/totp";
import crypto from "crypto";
import { RateLimits, rateLimit } from "@/lib/middleware/rate-limit";

const schema = z.object({ code: z.string().min(6).max(8) });

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// POST /api/auth/totp/verify — verify TOTP or backup code during MFA challenge
// Called by the /auth/mfa page; session must have mfaPending=true
export async function POST(request: NextRequest) {
  const session = await getServerSession(
    getAuthOptions() as Parameters<typeof getServerSession>[0],
  );

  const userId = (session?.user as { id?: string } | undefined)?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // A TOTP code is six digits — one million possibilities, and a valid one stays valid for the
  // length of its step window. Reaching here already requires a first factor, but MFA exists
  // precisely for the case where the first factor is compromised, so unlimited guessing would
  // make it decorative. Keyed per user rather than per IP: the attacker holds this session, and
  // a shared NAT should not let one victim's attempts lock out everyone behind it.
  const limited = await rateLimit(request, {
    ...RateLimits.AUTH,
    identifier: () => `totp-verify:${userId}`,
  });
  if (limited) return limited;

  try {
    const body = await readJson(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret || !user.totpEnabled) {
      return NextResponse.json({ error: "TOTP not enabled" }, { status: 400 });
    }

    const code = parsed.data.code.replace(/\s/g, "");
    const secret = decryptPII(user.totpSecret);

    // Try TOTP code first
    if (code.length === 6) {
      const isValid = totpVerify(code, secret);
      if (isValid) {
        await prisma.user.update({ where: { id: userId }, data: { totpVerifiedAt: new Date() } });
        return NextResponse.json({ ok: true });
      }
    }

    // Try backup code (8-char hex)
    if (user.totpBackupCodes) {
      const hashed = hashCode(code.toUpperCase());
      let codes: string[];
      try {
        codes = JSON.parse(decryptPII(user.totpBackupCodes)) as string[];
      } catch {
        return NextResponse.json({ error: "Invalid code" }, { status: 400 });
      }

      const idx = codes.indexOf(hashed);
      if (idx !== -1) {
        // Invalidate used backup code
        codes.splice(idx, 1);
        await prisma.user.update({
          where: { id: userId },
          data: {
            totpBackupCodes: encryptPII(JSON.stringify(codes)),
            totpVerifiedAt: new Date(),
          },
        });
        return NextResponse.json({ ok: true });
      }
    }

    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  } catch (err) {
    if (err instanceof ValidationError) return createErrorResponse(err, 400, request);
    console.error("TOTP verify error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
