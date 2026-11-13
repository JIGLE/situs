#!/usr/bin/env node
/**
 * Ensure the SQLite database file exists and is writable, then bring its schema up to this
 * version without losing data (`schema-sync.js`). In production a database that cannot be
 * created or updated stops the start, rather than serving 500s.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// DATABASE_URL may be unset; in that case we default to the same file
// prisma.config.ts uses (data/situs.db in production, dev.db otherwise).
if (!process.env.DATABASE_URL) {
  console.warn(
    "[ensure-sqlite] DATABASE_URL is not set; defaulting to prisma.config.ts's path " +
      `(${process.env.NODE_ENV === "production" ? "data/situs.db" : "dev.db"}).`,
  );
} else {
  console.debug(
    "[ensure-sqlite] DATABASE_URL is available:",
    process.env.DATABASE_URL.substring(0, 20) + "...",
  );
}

// Determine DB path from DATABASE_URL, falling back to the same default as
// prisma.config.ts (data/situs.db in production, dev.db otherwise) so every
// code path here targets the file the app actually reads.
const dbUrlFromEnv = process.env.DATABASE_URL;
const defaultDbFile = process.env.NODE_ENV === "production" ? "data/situs.db" : "dev.db";
let DB_PATH;
if (dbUrlFromEnv && dbUrlFromEnv.startsWith("file:")) {
  const dbPath = dbUrlFromEnv.replace(/^file:\/\//, "").replace(/^file:/, "");
  DB_PATH = path.resolve(process.cwd(), dbPath);
} else {
  DB_PATH = path.resolve(process.cwd(), defaultDbFile);
}
const BACKUP_PATH = `${DB_PATH}.backup`;

// Check if DB exists
const dbExists = fs.existsSync(DB_PATH);
console.debug(`[ensure-sqlite] DB path: ${DB_PATH} exists: ${dbExists}`);

// DB Reset Logic
const resetDb = process.env.RESET_DB === "true";
if (resetDb) {
  console.debug("[ensure-sqlite] DB reset enabled.");
  if (fs.existsSync(BACKUP_PATH)) {
    const expectedChecksum = process.env.DB_BACKUP_CHECKSUM;
    if (expectedChecksum) {
      const backupData = fs.readFileSync(BACKUP_PATH);
      const actualChecksum = crypto.createHash("sha256").update(backupData).digest("hex");
      if (actualChecksum !== expectedChecksum) {
        console.error(
          `[ensure-sqlite] Backup checksum mismatch! Expected: ${expectedChecksum}, Actual: ${actualChecksum}`,
        );
        process.exit(1);
      }
      console.debug("[ensure-sqlite] Backup checksum validated.");
    } else {
      console.debug("[ensure-sqlite] No checksum provided; proceeding without validation.");
    }
  } else {
    console.debug("[ensure-sqlite] No backup found; proceeding with clean DB.");
  }
}

function error(...args) {
  console.error("[ensure-sqlite]", ...args);
}

function log(...args) {
  console.debug("[ensure-sqlite]", ...args);
}

// Resolve the sqlite URL, mirroring prisma.config.ts's own default so this step
// always targets the SAME file the app reads. Previously, when DATABASE_URL was
// unset the whole ensure step was skipped — but prisma.config.ts still defaults
// to data/situs.db (prod), so the app's real DB never got migrated and every
// query 500'd with P2022 "column does not exist".
let dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  dbUrl = process.env.NODE_ENV === "production" ? "file:./data/situs.db" : "file:./dev.db";
  log(`DATABASE_URL not set; defaulting to ${dbUrl} (matches prisma.config.ts).`);
}
if (!dbUrl.startsWith("file:")) {
  log("DATABASE_URL is not sqlite (file:); skipping sqlite ensure step.");
  process.exit(0);
}
// Ensure child `prisma` invocations resolve to the same DB even if the env var
// was originally unset.
process.env.DATABASE_URL = dbUrl;

const dbPath = dbUrl.replace(/^file:\/\//, "").replace(/^file:/, "");
const resolved = path.resolve(process.cwd(), dbPath);
const dir = path.dirname(resolved);

try {
  fs.mkdirSync(dir, { recursive: true });
  const fd = fs.openSync(resolved, "a"); // create file if missing
  fs.closeSync(fd);
  fs.accessSync(resolved, fs.constants.W_OK);
} catch (err) {
  // This used to warn and exit 0 — "non-fatal". It is not non-fatal in production.
  //
  // `CMD` is `npm run prestart && node server.js`, so exiting 0 starts the server against a
  // database that does not exist. /api/ready answers 200 without touching the DB (deliberately,
  // so the container is not marked unhealthy while `prisma db push` runs), the Docker healthcheck
  // goes green, and the orchestrator reports the app HEALTHY while every data route 500s.
  // Sign-in keeps working because NextAuth uses JWT sessions, so it reads as a partial outage
  // rather than a missing database.
  //
  // That cost a day of diagnosis on a real deployment: the host path mounted at /app/data was
  // owned by root with mode 755, the container runs as uid 1001, and nothing anywhere said so.
  // A container that cannot reach its database should crash-loop visibly.
  error("Cannot create/write DB file:", resolved, err && err.message);
  error(
    `The container runs as nextjs:nextjs (uid/gid 1001:1001, see Dockerfile). If ${dir} is a ` +
      `mounted host directory, fix its ownership on the HOST (not inside the container):\n` +
      `     chown -R 1001:1001 ${dir} && chmod -R 770 ${dir}`,
  );

  // Same switch the schema step below uses — one escape hatch, not two.
  const failOnFs =
    process.env.PRESTART_FAIL_ON_SQLITE === "true" ||
    (process.env.NODE_ENV === "production" && process.env.PRESTART_FAIL_ON_SQLITE !== "false");

  if (failOnFs) {
    error(
      "Exiting rather than starting without a database (production mode). " +
        "Set PRESTART_FAIL_ON_SQLITE=false to start anyway and serve 500s.",
    );
    process.exit(1);
  }
  console.warn("[ensure-sqlite] Continuing startup without a writable database file.");
  process.exit(0);
}

// Bring the schema up to this version: compare, back up, push without data loss, verify.
// The rules live in schema-sync.js; this only decides what a failure means for the start.
const { syncSchema } = require("./schema-sync");

let result;
try {
  result = syncSchema({
    dbFile: resolved,
    dbUrl,
    log: (...a) => console.log("[database]", ...a),
    error,
  });
} catch (err) {
  error("Unexpected error while checking the database:", err && err.message);
  result = { ok: false, reason: "unexpected" };
}

if (!result.ok) {
  const failOnSchema =
    process.env.PRESTART_FAIL_ON_SQLITE === "true" ||
    (process.env.NODE_ENV === "production" && process.env.PRESTART_FAIL_ON_SQLITE !== "false");
  if (failOnSchema) {
    error(
      "Not starting the app on a database that does not match this version. " +
        "Fix the cause above and restart; AUTO_DB_SCHEMA_SYNC=false skips this step entirely.",
    );
    process.exit(1);
  }
  console.warn(
    "[ensure-sqlite] Database not in sync with the schema; continuing (not production).",
  );
}

process.exit(0);
