import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { summarize } from "@/lib/services/auth/passkey";
import { getPrismaClient } from "@/lib/services/database/database";

// GET /api/auth/passkey — the passkeys on the account, for Settings › Security.
//
// A read: it names no credential id and no key, only what the owner recognises them by.
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  try {
    const rows = await getPrismaClient().passkey.findMany({
      where: { userId: authResult.userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true, deviceType: true },
    });
    return NextResponse.json({ passkeys: rows.map(summarize) });
  } catch (err) {
    console.error("Passkey list error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
