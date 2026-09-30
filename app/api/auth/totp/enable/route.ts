import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { readJson, ValidationError } from "@/lib/utils/error-handling";
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
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;

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

    const secret = decryptPII(user.totpSecret);
    const isValid = totpVerify(parsed.data.code, secret);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    const backupCodes = generateBackupCodes();
    const hashedCodes = backupCodes.map(hashCode);

    await prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabled: true,
        totpBackupCodes: encryptPII(JSON.stringify(hashedCodes)),
      },
    });

    return NextResponse.json({ backupCodes });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("TOTP enable error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
