import { z } from "zod";

// Environment variables schema
const envSchema = z.object({
  // Database - optional in development (will use mock data)
  DATABASE_URL: z.string().url().optional(),

  // NextAuth
  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(32).optional(),

  // Google OAuth (optional at build-time; enforced at runtime when OAuth is enabled)
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  // Node environment
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Optional: Email service (for future use)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Feature flags (use 'true' to enable)
  ENABLE_STRIPE: z.string().optional(),
  ENABLE_OAUTH: z.string().optional(),
  ENABLE_DEMO_LOGIN: z.string().optional(),
  // Enforce subscription plan limits (e.g. property count). Off by default so
  // self-hosted instances are never limited — see docs/PRODUCT_AUDIT_2026.md §2.
  ENABLE_BILLING: z.string().optional(),

  // PII encryption key (AES-256-GCM, 32-byte hex)
  PII_ENCRYPTION_KEY: z.string().min(64).optional(),

  // SAF-T PT signing key path (RSA private key in PEM)
  SAFT_SIGNING_KEY_PATH: z.string().optional(),
  SAFT_CERTIFICATE_NUMBER: z.string().optional(),
});

// Validate environment variables
let env: z.infer<typeof envSchema> | undefined;

const parsed = envSchema.safeParse(process.env);

if (parsed.success) {
  env = parsed.data;
  // In test mode, ensure some runtime secrets/urls are present for tests
  if (process.env.NODE_ENV === "test") {
    env = {
      ...env,
      NEXTAUTH_URL: env.NEXTAUTH_URL ?? "http://localhost:3000",
      NEXTAUTH_SECRET: env.NEXTAUTH_SECRET ?? "test-secret-should-be-long-enough-for-dev",
      NODE_ENV: "test",
    } as z.infer<typeof envSchema>;
  }

  // Enforce DATABASE_URL in non-development environments (skip at build time / CI)
  const _isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
  const _isBuildTime = _isCI || process.env.NEXT_BUILD === "true";
  if (
    process.env.NODE_ENV !== "development" &&
    process.env.NODE_ENV !== "test" &&
    !_isBuildTime &&
    !env.DATABASE_URL
  ) {
    console.error("❌ DATABASE_URL is required in production environments");
    process.exit(1);
  }

  // Enforce PII encryption in production.
  //
  // encryptPII() returns plaintext when no key is configured — a deliberate dev-mode convenience
  // that fails OPEN. Without this check a production deploy that simply forgot the variable looks
  // completely healthy while writing tenant IBANs, NIFs and phone numbers to disk in the clear,
  // with no error and no log line. That is the worst possible failure mode for the one control
  // standing between a stolen database file and a GDPR Article 33 notification.
  //
  // Refusing to boot is the point. An operator who genuinely wants unencrypted PII — a throwaway
  // staging box, a migration window — sets ALLOW_UNENCRYPTED_PII=true and gets a loud warning on
  // every start. What they no longer get is silence.
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test" && !_isBuildTime) {
    const keyConfigured = !!env.PII_ENCRYPTION_KEY && env.PII_ENCRYPTION_KEY.length >= 64;
    const explicitlyWaived = process.env.ALLOW_UNENCRYPTED_PII === "true";

    if (!keyConfigured && !explicitlyWaived) {
      console.error(
        "❌ PII_ENCRYPTION_KEY is required in production (64-char hex). Without it, IBAN, NIF " +
          "and phone fields are stored in plaintext. Generate one with:\n" +
          "     openssl rand -hex 32\n" +
          "   To run without encryption anyway, set ALLOW_UNENCRYPTED_PII=true.",
      );
      process.exit(1);
    }

    if (!keyConfigured && explicitlyWaived) {
      console.warn(
        "⚠️  ALLOW_UNENCRYPTED_PII=true — IBAN, NIF and phone fields are being stored in " +
          "PLAINTEXT. This is not suitable for real tenant data.",
      );
    }
  }

  // If OAuth is enabled and we're running a real production server (not CI/build), enforce auth envs
  const oauthEnabled =
    process.env.ENABLE_OAUTH === "true" ||
    !!process.env.GOOGLE_CLIENT_ID ||
    !!process.env.GOOGLE_CLIENT_SECRET;
  const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
  const isBuildTime = isCI || process.env.NEXT_BUILD === "true";

  if (process.env.NODE_ENV === "production" && oauthEnabled && !isBuildTime) {
    if (!env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET.length < 32) {
      console.error(
        "❌ NEXTAUTH_SECRET must be set and at least 32 characters when OAuth is enabled in production",
      );
      process.exit(1);
    }
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      console.error(
        "❌ GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set when OAuth is enabled in production",
      );
      process.exit(1);
    }
  }
} else {
  // If we're in test mode, tolerate missing environment variables and provide sensible defaults
  if (process.env.NODE_ENV === "test") {
    console.debug(
      "⚠️ Environment validation failed, but continuing because NODE_ENV=test:",
      parsed.error,
    );
    const partialEnv = envSchema.partial().parse(process.env);
    env = {
      DATABASE_URL: partialEnv.DATABASE_URL,
      NEXTAUTH_URL: partialEnv.NEXTAUTH_URL ?? "http://localhost:3000",
      NEXTAUTH_SECRET: partialEnv.NEXTAUTH_SECRET ?? "test-secret-should-be-long-enough-for-dev",
      GOOGLE_CLIENT_ID: partialEnv.GOOGLE_CLIENT_ID ?? "",
      GOOGLE_CLIENT_SECRET: partialEnv.GOOGLE_CLIENT_SECRET ?? "",
      NODE_ENV: (process.env.NODE_ENV as "development" | "production" | "test") ?? "test",
      SMTP_HOST: partialEnv.SMTP_HOST,
      SMTP_PORT: partialEnv.SMTP_PORT,
      SMTP_USER: partialEnv.SMTP_USER,
      SMTP_PASS: partialEnv.SMTP_PASS,
    } as z.infer<typeof envSchema>;
  } else {
    console.error("❌ Invalid environment variables:", parsed.error);
    process.exit(1);
  }
}

export { env as env };

/**
 * Helper: read a secret from env or from mounted secret files (if present).
 * Looks up process.env first, then common secret file mounts.
 */
import fs from "fs";
import path from "path";

export function getSecret(name: string): string | undefined {
  const envVal = process.env[name];
  if (envVal && envVal.length > 0) return envVal;

  const candidatePaths = [
    `/run/secrets/${name}`,
    `/var/run/secrets/${name}`,
    path.join(process.cwd(), "secrets", name),
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const val = fs.readFileSync(p, "utf8").trim();
        if (val.length > 0) return val;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

/**
 * Helper: feature flag parsing. Returns true when env value is 'true' or '1'.
 */
export function isEnabled(envName: string): boolean {
  const v = process.env[envName] || undefined;
  if (!v) return false;
  return v.toLowerCase() === "true" || v === "1";
}

// Type-safe environment variables
export type Env = z.infer<typeof envSchema>;
