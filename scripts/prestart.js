#!/usr/bin/env node
/**
 * Prestart orchestrator: runs the checks the container needs before `node server.js`.
 * - SKIP_PRESTART=true  -> skip all checks
 * - PRESTART_CHECK_HOSTPORT=true -> enforce host/port validation
 * - SQLite (DATABASE_URL `file:` or unset) -> ensure-sqlite: create the file, update its schema
 *
 * Each step runs as its own Node process. They used to be `require`d into this one, and every
 * step ends in `process.exit`: check-hostport exits 0 whenever it passes, which ended prestart
 * right there, so in the image (HOSTNAME and PORT always set) ensure-sqlite never ran and the
 * database was never created or updated on start. `tests/prestart-chain.test.ts` holds that.
 */

const { spawnSync } = require("child_process");
const path = require("path");

if (process.env.SKIP_PRESTART === "true") {
  console.log("[prestart] SKIP_PRESTART=true; skipping prestart checks.");
  process.exit(0);
}

function run(script) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[prestart] ${script} could not run:`, result.error.message);
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

// validate-env exits 1 when a required variable is missing or invalid.
if (run("validate-env.js") !== 0) {
  console.error("[prestart] Environment validation failed; not starting.");
  process.exit(1);
}

// Non-zero only when PRESTART_CHECK_HOSTPORT=true and the check fails.
if (run("check-hostport.js") !== 0) {
  console.error("[prestart] check-hostport failed; not starting.");
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || "";
if (!dbUrl || dbUrl.startsWith("file:")) {
  console.log("[prestart] SQLite mode detected. Running database checks...");
  // ensure-sqlite decides itself what is fatal (production) and what only warns (development).
  if (run("ensure-sqlite.js") !== 0) {
    console.error(
      "[prestart] FATAL: the database could not be prepared, so the app will not start. " +
        "The lines above say why.",
    );
    process.exit(1);
  }
} else {
  console.log("[prestart] DATABASE_URL does not indicate sqlite; skipping sqlite ensure step.");
}

console.log("[prestart] Prestart checks complete.");
process.exit(0);
