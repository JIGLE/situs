import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { csrfProtection } from "@/lib/middleware/csrf";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { encryptPII } from "@/lib/utils/pii-encryption";
import { totpGenerateSecret, totpKeyuri } from "@/lib/utils/totp";

const APP_NAME = "Situs";

const ALREADY_ON = {
  error: "Two-factor authentication is already on",
  reason: "totp_already_enabled",
};

// POST /api/auth/totp/setup — generate a new TOTP secret and QR code URI
//
// A POST that checks its own CSRF token: it writes a new secret, and /api/auth/** is public in
// proxy.ts, so the proxy checks neither the session nor the token here. As a GET it was reachable
// by a link followed while signed in, and it switched an enabled second factor off.
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const csrfError = await csrfProtection(request);
  if (csrfError) return csrfError;

  const { userId } = authResult;

  try {
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // A second factor that is on is turned off by `disable`, never replaced from here.
    if (user.totpEnabled) return NextResponse.json(ALREADY_ON, { status: 409 });

    // Generate a fresh secret (not enabled until user confirms via /enable)
    const secret = totpGenerateSecret();
    const otpauth = totpKeyuri(user.email ?? userId, APP_NAME, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    // Persist the pending secret encrypted. Written only while the factor is still off: one
    // confirmed between the read above and this write must keep the secret it was confirmed with.
    const stored = await prisma.user.updateMany({
      where: { id: userId, totpEnabled: false },
      data: { totpSecret: encryptPII(secret) },
    });
    if (stored.count === 0) return NextResponse.json(ALREADY_ON, { status: 409 });

    return NextResponse.json({ secret, qrDataUrl, otpauth });
  } catch (err) {
    console.error("TOTP setup error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
