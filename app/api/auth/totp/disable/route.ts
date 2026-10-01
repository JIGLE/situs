import { NextRequest, NextResponse } from "next/server";
import { csrfProtection } from "@/lib/middleware/csrf";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";

// DELETE /api/auth/totp/disable — remove TOTP from the account
//
// Checks its own CSRF token: /api/auth/** is public in proxy.ts, so the proxy checks none here.
export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const csrfError = await csrfProtection(request);
  if (csrfError) return csrfError;

  const { userId } = authResult;

  try {
    const prisma = getPrismaClient();
    await prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null, totpBackupCodes: null },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("TOTP disable error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
