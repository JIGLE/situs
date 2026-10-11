import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { csrfProtection } from "@/lib/middleware/csrf";
import { rateLimit } from "@/lib/middleware/rate-limit";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { provesSecondFactor } from "@/lib/services/auth/second-factor-code";
import { totpGuessLimit } from "@/lib/services/auth/totp-guess-limit";
import { getPrismaClient } from "@/lib/services/database/database";
import { createErrorResponse, readJson, ValidationError } from "@/lib/utils/error-handling";

const schema = z.object({ code: z.string().min(6).max(8) });

// DELETE /api/auth/passkey/[id] — remove a passkey from the account
//
// Checks its own CSRF token: /api/auth/** is public in proxy.ts, so the proxy checks none here.
//
// Takes a code from the authenticator app, as adding one does: a held session could otherwise
// remove the owner's passkeys and leave its own in place. Scoped to the account by the query, so an
// id that is someone else's is simply not found.
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const csrfError = await csrfProtection(request);
  if (csrfError) return csrfError;

  const { userId } = authResult;
  const { id } = await context.params;

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
      select: { totpSecret: true, totpBackupCodes: true },
    });
    if (!user || !provesSecondFactor(user, parsed.data.code)) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    const removed = await prisma.passkey.deleteMany({ where: { id, userId } });
    if (removed.count === 0) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) return createErrorResponse(err, 400, request);
    console.error("Passkey delete error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
