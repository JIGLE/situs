#!/usr/bin/env node

/**
 * Environment variable validation script for Situs.
 *
 * Run before starting the application to ensure all required
 * environment variables are set. Usable from CI and package.json scripts.
 *
 * Usage:
 *   node scripts/validate-env.js          # validates for current NODE_ENV
 *   node scripts/validate-env.js --strict # exits non-zero on warnings too
 */

const strict = process.argv.includes("--strict");

// ── helpers ──────────────────────────────────────────────────────────────
const errors = [];
const warnings = [];

function requireVar(name, message) {
  if (!process.env[name]) {
    errors.push(`  ✗ ${name} — ${message}`);
  }
}

function warnVar(name, message) {
  if (!process.env[name]) {
    warnings.push(`  ⚠ ${name} — ${message}`);
  }
}

function requireVarIf(condition, name, message) {
  if (condition && !process.env[name]) {
    errors.push(`  ✗ ${name} — ${message}`);
  }
}

// ── validation rules ─────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === "production";
const oauthEnabled = process.env.ENABLE_OAUTH === "true";
const billingEnabled = process.env.ENABLE_BILLING === "true";

// Always required
requireVar("NEXTAUTH_URL", "Full URL where the app is hosted (e.g. https://your.domain.com)");

// Required in production
if (isProd) {
  requireVar(
    "NEXTAUTH_SECRET",
    "Session signing secret (min 32 chars). Generate: openssl rand -base64 32",
  );
  requireVar("DATABASE_URL", "Database connection string (e.g. file:/app/data/situs.sqlite)");
}

// NEXTAUTH_SECRET length check
if (process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_SECRET.length < 32) {
  warnings.push("  ⚠ NEXTAUTH_SECRET — should be at least 32 characters for security");
}

// OAuth credentials
requireVarIf(oauthEnabled, "GOOGLE_CLIENT_ID", "Required when ENABLE_OAUTH=true");
requireVarIf(oauthEnabled, "GOOGLE_CLIENT_SECRET", "Required when ENABLE_OAUTH=true");

// Subscription billing — plan-limit enforcement needs real Stripe Prices to sell.
requireVarIf(
  billingEnabled,
  "STRIPE_PRICE_ID_PRO",
  "Required when ENABLE_BILLING=true (create a Price in Stripe Dashboard)",
);
requireVarIf(
  billingEnabled,
  "STRIPE_PRICE_ID_BUSINESS",
  "Required when ENABLE_BILLING=true (create a Price in Stripe Dashboard)",
);

// Non-critical services. Mail goes out over SMTP (lib/services/email/transport.ts); without a host
// the instance starts and simply does not send.
warnVar("SMTP_HOST", "Email sending will be disabled");
warnVar("FROM_EMAIL", "Defaults to noreply@situs.app");

// PII field encryption (IBANs, NIFs, phone numbers) — see lib/utils/pii-encryption.ts.
// Without a key, encryptPII() writes plaintext. The server refuses to start in that state
// (instrumentation.ts runs lib/utils/env.ts at boot), so refuse here too, before prestart touches
// the database — with the same explicit waiver.
if (isProd) {
  const keyConfigured =
    !!process.env.PII_ENCRYPTION_KEY && process.env.PII_ENCRYPTION_KEY.length >= 64;
  if (!keyConfigured && process.env.ALLOW_UNENCRYPTED_PII === "true") {
    warnings.push(
      "  ⚠ PII_ENCRYPTION_KEY — unset, and ALLOW_UNENCRYPTED_PII=true: IBAN, NIF and phone are " +
        "stored in PLAINTEXT",
    );
  } else if (!keyConfigured) {
    errors.push(
      "  ✗ PII_ENCRYPTION_KEY — 64 hex characters, required in production. Generate one with " +
        "openssl rand -hex 32; an instance that already holds data then runs " +
        "scripts/backfill-pii-encryption.js. ALLOW_UNENCRYPTED_PII=true runs without it.",
    );
  }
} else if (process.env.PII_ENCRYPTION_KEY && process.env.PII_ENCRYPTION_KEY.length < 64) {
  warnings.push(
    "  ⚠ PII_ENCRYPTION_KEY — must be 64 hex characters (32 bytes); shorter values are ignored",
  );
}

// ── output ───────────────────────────────────────────────────────────────
console.log("");
console.log("🔍 Situs Environment Validation");
console.log(`   NODE_ENV = ${process.env.NODE_ENV || "(unset)"}`);
console.log("");

if (warnings.length > 0) {
  console.log("Warnings:");
  warnings.forEach((w) => console.log(w));
  console.log("");
}

if (errors.length > 0) {
  console.log("Errors:");
  errors.forEach((e) => console.log(e));
  console.log("");
  console.error(`❌ ${errors.length} required variable(s) missing. Fix the above before starting.`);
  process.exit(1);
}

if (strict && warnings.length > 0) {
  console.error(`❌ ${warnings.length} warning(s) found in --strict mode.`);
  process.exit(1);
}

console.log("✅ Environment looks good.\n");
