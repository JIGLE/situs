#!/usr/bin/env node
/*
 * Backfill PII field encryption for rows written before the Prisma
 * extension existed (lib/services/database/pii-extension.ts).
 *
 * That extension transparently encrypts PII_FIELDS (IBANs, NIFs, phone
 * numbers — see lib/utils/pii-encryption.ts) on every create/update going
 * forward, but rows already in the database at the time it was added are
 * still plaintext at rest. This script finds and re-encrypts them.
 *
 * Deliberately standalone (mirrors scripts/delete-user.js): it talks to
 * Prisma directly, WITHOUT the pii-extension, so it can tell plaintext
 * apart from already-encrypted values with isEncrypted() and only touch
 * rows that need it — an idempotent, explicit, auditable one-off, not a
 * blind read-through-the-extension-and-write-back round trip.
 *
 * Requires PII_ENCRYPTION_KEY. Without it, encryptPII() is a no-op (matches
 * the intentional dev-mode "no key = plaintext" behavior) and this script
 * exits early rather than pretending to have done something.
 *
 * Usage:
 *   node scripts/backfill-pii-encryption.js           # apply
 *   node scripts/backfill-pii-encryption.js --dry-run # report only, no writes
 */

"use strict";

require("dotenv").config();
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

const dryRun = process.argv.includes("--dry-run");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const ENCODING = "base64";
const ENCRYPTED_PREFIX = "enc:";

// Prisma 7 connects only through a driver adapter — a bare `new PrismaClient()` throws before doing
// anything. This is the adapter lib/services/database/database.ts uses, without its PII extension.
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.NODE_ENV === "production") {
    // Guessing a path here would open (and create) an empty file and report nothing to do.
    console.error("DATABASE_URL is not set. In the container it is file:/app/data/situs.sqlite.");
    process.exit(1);
  }
  return "file:./dev.db";
}

function getEncryptionKey() {
  const hex = process.env.PII_ENCRYPTION_KEY;
  if (!hex || hex.length < 64) return null;
  return Buffer.from(hex, "hex");
}

function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

function encryptPII(plaintext, key) {
  if (!plaintext) return plaintext;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${iv.toString(ENCODING)}:${tag.toString(ENCODING)}:${encrypted.toString(ENCODING)}`;
}

// Mirrors lib/utils/pii-encryption.ts PII_FIELDS, keyed by Prisma delegate name — this script
// intentionally has no path-alias/TS import. tests/pii-backfill-contract.test.ts fails when the two
// differ: "kept in sync manually" let a deleted model (paymentMethod) sit here, and the first loop
// iteration threw on `prisma.paymentMethod` before touching a single row.
const PII_FIELDS = {
  owner: ["taxIdentificationNumber", "phone"],
  tenant: ["phone"],
  rentReceipt: ["landlordNif", "tenantNif"],
  nRUARegistration: ["landlordNif", "tenantNif"],
};

async function main() {
  const key = getEncryptionKey();
  if (!key) {
    console.error(
      "PII_ENCRYPTION_KEY is not set (or shorter than 64 hex chars) — nothing to backfill.\n" +
        "Set it and re-run once you're ready to encrypt PII at rest.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl() }) });

  let totalRows = 0;
  let totalFields = 0;

  try {
    for (const [model, fields] of Object.entries(PII_FIELDS)) {
      const rows = await prisma[model].findMany({
        select: Object.fromEntries([["id", true], ...fields.map((f) => [f, true])]),
      });

      for (const row of rows) {
        const update = {};
        for (const field of fields) {
          const value = row[field];
          if (typeof value === "string" && value.length > 0 && !isEncrypted(value)) {
            update[field] = encryptPII(value, key);
          }
        }
        if (Object.keys(update).length === 0) continue;

        totalRows++;
        totalFields += Object.keys(update).length;
        console.log(
          `${dryRun ? "[dry-run] would encrypt" : "encrypting"} ${model}#${row.id}: ${Object.keys(update).join(", ")}`,
        );
        if (!dryRun) {
          await prisma[model].update({ where: { id: row.id }, data: update });
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    `\n${dryRun ? "Would encrypt" : "Encrypted"} ${totalFields} field(s) across ${totalRows} row(s).`,
  );
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
