import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { csrfProtection } from "@/lib/middleware/csrf";
import { RateLimits, rateLimit } from "@/lib/middleware/rate-limit";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { createErrorResponse, readJson, ValidationError } from "@/lib/utils/error-handling";
import { decryptPII } from "@/lib/utils/pii-encryption";
import { totpVerify } from "@/lib/utils/totp";

const schema = z.object({ code: z.string().min(6).max(8) });

const hashCode = (code: string): string => crypto.createHash("sha256").update(code).digest("hex");

// DELETE /api/auth/totp/disable — remove TOTP from the account
//
// Checks its own CSRF token: /api/auth/** is public in proxy.ts, so the proxy checks none here.
//
// Turning the second factor OFF takes a code from it, an authenticator code or a backup code, since
// the session that asks may be one someone else is holding: with the factor on, a session that has
// passed it is all `requireAuth` can tell, and a stolen cookie would otherwise remove the very
// thing that is there for when the first factor is stolen. An account whose factor is not on yet
// (a setup that was never confirmed) has nothing to prove and is cleared without one. Guesses share
// the verify route's budget, per user, so this is not a second place to try six digits.
export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const csrfError = await csrfProtection(request);
  if (csrfError) return csrfError;

  const { userId } = authResult;

  try {
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { totpEnabled: true, totpSecret: true, totpBackupCodes: true },
    });

    if (user?.totpEnabled && user.totpSecret) {
      const limited = await rateLimit(request, {
        ...RateLimits.AUTH,
        identifier: () => `totp-verify:${userId}`,
      });
      if (limited) return limited;

      const body = await readJson(request);
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }

      const code = parsed.data.code.replace(/\s/g, "");
      let proved = code.length === 6 && totpVerify(code, decryptPII(user.totpSecret));
      if (!proved && user.totpBackupCodes) {
        try {
          const codes = JSON.parse(decryptPII(user.totpBackupCodes)) as string[];
          proved = codes.includes(hashCode(code.toUpperCase()));
        } catch {
          proved = false;
        }
      }
      if (!proved) return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    // Only the factor the code was checked against: a new setup that landed since the read has
    // changed the secret, and clearing it then would remove a factor nobody proved they hold.
    const cleared = await prisma.user.updateMany({
      where: { id: userId, totpSecret: user?.totpSecret ?? null },
      data: { totpEnabled: false, totpSecret: null, totpBackupCodes: null },
    });
    if (cleared.count === 0) {
      return NextResponse.json(
        { error: "Two-factor setup changed; start again", reason: "totp_setup_changed" },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) return createErrorResponse(err, 400, request);
    console.error("TOTP disable error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
