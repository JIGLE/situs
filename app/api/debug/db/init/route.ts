import { NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { isMockMode } from "@/lib/config/data-mode";
import { resolveClientIp } from "@/lib/utils/security";

export const runtime = "nodejs";

// Simple in-memory rate limiting (per IP)
const initRequestTimestamps = new Map<string, number[]>();
const MAX_INIT_REQUESTS = 5; // max 5 requests
const RATE_LIMIT_WINDOW = 3600000; // 1 hour

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = initRequestTimestamps.get(ip) || [];
  const recentTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);

  if (recentTimestamps.length >= MAX_INIT_REQUESTS) {
    return true;
  }

  recentTimestamps.push(now);
  initRequestTimestamps.set(ip, recentTimestamps);
  return false;
}

function verifyHmacSignature(payload: string, signature: string, secret: string): boolean {
  try {
    const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  // In mock mode, database initialization is not needed
  if (isMockMode) {
    return NextResponse.json(
      {
        ok: true,
        message: "Mock mode active - database initialization skipped",
        mode: "mock",
      },
      { status: 200 },
    );
  }

  // Security: INIT_SECRET is required for production
  const initSecret = process.env.INIT_SECRET;
  const nodeEnv = process.env.NODE_ENV;

  // In production, always require INIT_SECRET
  if (nodeEnv === "production" && !initSecret) {
    console.error(
      "[db/init] Production deployment without INIT_SECRET — this endpoint is disabled for security",
    );
    return NextResponse.json({ ok: false, error: "not available" }, { status: 403 });
  }

  // The client address the trusted proxy saw. The leftmost X-Forwarded-For entry is whatever the
  // caller wrote, so keying on it handed every request a fresh bucket for the asking.
  const ip = resolveClientIp(request);

  // Apply rate limiting
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "rate limit exceeded — max 5 requests per hour" },
      { status: 429 },
    );
  }

  // HMAC signature verification (if secret is set)
  if (initSecret) {
    const auth = request.headers.get("authorization") || "";
    const signature = request.headers.get("x-signature") || "";

    // Accept either Bearer token or HMAC signature (Bearer for backwards compatibility)
    const isBearerValid = auth.startsWith("Bearer ") && auth.slice(7) === initSecret;

    let isSignatureValid = false;
    if (signature && auth) {
      try {
        const payload = `${request.method}${request.url}${initSecret}`;
        isSignatureValid = verifyHmacSignature(payload, signature, initSecret);
      } catch (err) {
        console.debug(
          "HMAC verification failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    if (!isBearerValid && !isSignatureValid) {
      console.warn(`[db/init] Unauthorized attempt from IP: ${ip}`);
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.startsWith("file:")) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL not configured for sqlite" },
      { status: 400 },
    );
  }

  const dbPath = dbUrl.replace(/^file:\/\//, "").replace(/^file:/, "");
  const resolved = path.resolve(process.cwd(), dbPath);
  const dir = path.dirname(resolved);

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err: unknown) {
    console.error("[db/init] failed to create directory", err);
    return NextResponse.json(
      { ok: false, error: "failed to prepare database directory" },
      { status: 500 },
    );
  }

  try {
    const fd = fs.openSync(resolved, "a");
    fs.closeSync(fd);
  } catch (err: unknown) {
    console.error("[db/init] failed to create database file", err);
    return NextResponse.json(
      { ok: false, error: "failed to create database file" },
      { status: 500 },
    );
  }

  try {
    fs.accessSync(resolved, fs.constants.W_OK);
  } catch (err: unknown) {
    console.error("[db/init] database file not writable", err);
    return NextResponse.json(
      { ok: false, error: "database file is not writable" },
      { status: 500 },
    );
  }

  try {
    // In test environments we skip running prisma commands to avoid long-running or environment dependent work.
    if (process.env.NODE_ENV === "test") {
      const pushOut = "skipped (test)";
      const genOut = "skipped (test)";
      return NextResponse.json({ ok: true, dbPath: resolved, pushOut, genOut });
    }

    // Run prisma commands and capture output
    const pushOut = execSync("npx prisma db push", {
      stdio: "pipe",
    }).toString();
    const genOut = execSync("npx prisma generate", {
      stdio: "pipe",
    }).toString();
    return NextResponse.json({ ok: true, dbPath: resolved, pushOut, genOut });
  } catch (err: unknown) {
    const maybeErr = err as { stdout?: unknown; stderr?: unknown };
    const stdout =
      typeof maybeErr.stdout === "string"
        ? maybeErr.stdout
        : typeof maybeErr.stdout === "object" && maybeErr.stdout?.toString
          ? maybeErr.stdout.toString()
          : undefined;
    const stderr =
      typeof maybeErr.stderr === "string"
        ? maybeErr.stderr
        : typeof maybeErr.stderr === "object" && maybeErr.stderr?.toString
          ? maybeErr.stderr.toString()
          : undefined;
    console.error("[db/init] prisma command failed", {
      message: err instanceof Error ? err.message : String(err),
      stdout,
      stderr,
    });
    return NextResponse.json(
      { ok: false, error: "database initialization failed" },
      { status: 500 },
    );
  }
}
