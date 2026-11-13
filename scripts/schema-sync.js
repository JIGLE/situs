/**
 * Brings the SQLite database up to `prisma/schema.prisma` on start, without ever losing data.
 *
 * Called by `ensure-sqlite.js` once the database file exists and is writable. In order:
 *
 *   1. Ask Prisma what would change (`migrate diff`, read-only). Nothing: done.
 *   2. Copy the database to `<data dir>/backups/` (`VACUUM INTO`, a consistent copy even with a
 *      WAL), check the copy, and refuse to touch the schema when the copy cannot be made.
 *   3. `prisma db push` WITHOUT `--accept-data-loss`: Prisma refuses, and changes nothing, when
 *      the new schema would drop a table or a column that holds data.
 *   4. Ask Prisma again: the database must now match the schema exactly.
 *
 * Any failure after step 2 puts the copy back when the file changed, and returns a failure, so
 * the server never starts on a half-applied schema. A refusal to drop data is the one case the
 * owner can override, deliberately, with AUTO_DB_SCHEMA_SYNC_FORCE=true for one start (after the
 * same backup).
 *
 * The earlier version of this step forced `--accept-data-loss` by default whenever the plain push
 * failed. It never ran in the image, because prestart exited before reaching it (see
 * `prestart.js`), so making it run had to start by taking that default away.
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCHEMA = "prisma/schema.prisma";
const PRISMA_TIMEOUT_MS = 5 * 60 * 1000;
/** Backups this step keeps; older ones it made are deleted. Other files in the folder are left. */
const KEEP_BACKUPS = 5;
const BACKUP_MARK = "-before-update-";

function flag(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

/** The CLI, unless a test hands in a stand-in (`prismaBin`), as it does to make a push fail midway. */
let prismaBin = null;

function runPrisma(args, dbUrl) {
  const local = path.join(process.cwd(), "node_modules", ".bin", "prisma");
  const [cmd, pre] = prismaBin
    ? [process.execPath, [prismaBin]]
    : fs.existsSync(local)
      ? [local, []]
      : ["npx", ["prisma"]];
  const result = spawnSync(cmd, [...pre, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
    timeout: PRISMA_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status === null ? -1 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    output: `${result.stdout || ""}${result.stderr || ""}`,
    error: result.error,
  };
}

/** `migrate diff --exit-code`: 0 nothing to do, 2 changes (SQL on stdout), anything else failed. */
function pendingChanges(dbUrl) {
  const r = runPrisma(
    [
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      SCHEMA,
      "--script",
      "--exit-code",
    ],
    dbUrl,
  );
  if (r.status === 0) return { ok: true, sql: "" };
  if (r.status === 2) return { ok: true, sql: r.stdout.trim() };
  return { ok: false, detail: (r.error && r.error.message) || r.output.trim() };
}

/** The same diff in words, for the log. Best effort: a failure here only loses the summary. */
function describeChanges(dbUrl) {
  const r = runPrisma(
    ["migrate", "diff", "--from-config-datasource", "--to-schema", SCHEMA],
    dbUrl,
  );
  return r.status === 0 || r.status === 2 ? r.stdout.trim() : "";
}

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hasTables(Database, file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const row = db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .get();
    return row.n > 0;
  } finally {
    db.close();
  }
}

function checkCopy(Database, file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return db.pragma("quick_check", { simple: true }) === "ok";
  } finally {
    db.close();
  }
}

/**
 * A checked copy of the database, named after what it holds and what is about to change, so a
 * start that fails and is retried (TrueNAS restarts a stopped container) reuses the copy instead
 * of filling the disk with identical ones.
 */
function backup(Database, dbFile, key, log) {
  const dir = path.join(path.dirname(dbFile), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(dbFile).replace(/\.[^.]+$/, "");
  const existing = fs.readdirSync(dir).find((f) => f.endsWith(`-${key}.sqlite`));
  if (existing) {
    const file = path.join(dir, existing);
    if (checkCopy(Database, file)) {
      log(`A backup of this database from the last attempt is already there: ${file}`);
      return file;
    }
    fs.rmSync(file, { force: true });
  }

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-\d{3}Z$/, "Z");
  const file = path.join(dir, `${base}${BACKUP_MARK}${stamp}-${key}.sqlite`);
  const partial = `${file}.partial`;
  fs.rmSync(partial, { force: true });

  const db = new Database(dbFile, { fileMustExist: true });
  try {
    db.prepare("VACUUM INTO ?").run(partial);
  } finally {
    db.close();
  }
  if (!checkCopy(Database, partial)) {
    fs.rmSync(partial, { force: true });
    throw new Error("the copy failed SQLite's integrity check");
  }
  fs.renameSync(partial, file);
  log(`Backed up the database before changing it: ${file}`);
  prune(dir, log);
  return file;
}

function prune(dir, log) {
  const ours = fs
    .readdirSync(dir)
    .filter((f) => f.includes(BACKUP_MARK) && f.endsWith(".sqlite"))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of ours.slice(KEEP_BACKUPS)) {
    fs.rmSync(path.join(dir, f), { force: true });
    log(`Deleted an old backup (keeping the last ${KEEP_BACKUPS}): ${f}`);
  }
}

/** Put the copy back. Only ever runs before the server starts, so nothing else has the file open. */
function restore(dbFile, copy) {
  const tmp = `${dbFile}.restoring`;
  fs.copyFileSync(copy, tmp);
  for (const suffix of ["-wal", "-shm", "-journal"])
    fs.rmSync(`${dbFile}${suffix}`, { force: true });
  fs.renameSync(tmp, dbFile);
}

const confirmsSync = (out) => /in sync with (your|the) prisma schema/i.test(out);
const refusedDataLoss = (out) => /accept-data-loss|data loss/i.test(out);

/**
 * @param {{ dbFile: string, dbUrl: string, log: Function, error: Function, prisma?: string | null }} opts
 *   `prisma`: a Node script to run instead of the Prisma CLI (tests only).
 * @returns {{ ok: boolean, reason: string }} ok false means: do not start the server.
 */
function syncSchema({ dbFile, dbUrl, log, error, prisma = null }) {
  prismaBin = prisma;
  const Database = require("better-sqlite3");
  const isEmpty = !hasTables(Database, dbFile);

  if (isEmpty && !flag("AUTO_DB_INIT", true)) {
    error("The database has no tables and AUTO_DB_INIT=false, so nothing creates them.");
    return { ok: false, reason: "empty_database" };
  }
  if (!isEmpty && !flag("AUTO_DB_SCHEMA_SYNC", true)) {
    log("AUTO_DB_SCHEMA_SYNC=false: leaving the database schema as it is.");
    return { ok: true, reason: "disabled" };
  }

  log("Checking the database against this version's schema...");
  const before = pendingChanges(dbUrl);
  if (!before.ok) {
    error("Could not compare the database with the schema, so nothing was changed.");
    error(before.detail);
    return { ok: false, reason: "diff_failed" };
  }
  if (!before.sql) {
    log("The database is up to date. Nothing to change.");
    return { ok: true, reason: "in_sync" };
  }

  if (isEmpty) {
    log("New database: creating the tables.");
  } else {
    const summary = describeChanges(dbUrl);
    log("This version changes the database:");
    if (summary) console.log(summary);
  }

  let copy = null;
  let hashBefore = null;
  if (!isEmpty) {
    hashBefore = fileHash(dbFile);
    const key = crypto
      .createHash("sha256")
      .update(hashBefore)
      .update(before.sql)
      .digest("hex")
      .slice(0, 12);
    try {
      copy = backup(Database, dbFile, key, log);
    } catch (err) {
      error("Could not back up the database, so its schema was not changed:", err && err.message);
      error("Check that the data folder has free space and is writable by uid 1001.");
      return { ok: false, reason: "backup_failed" };
    }
  }

  const putBack = () => {
    if (!copy || fileHash(dbFile) === hashBefore) return;
    try {
      restore(dbFile, copy);
      log(`The database was put back as it was before the update, from ${copy}`);
    } catch (err) {
      error(`Could not put the backup back (${err && err.message}). Restore it by hand: ${copy}`);
    }
  };

  let push = runPrisma(["db", "push"], dbUrl);
  if (push.status !== 0 || !confirmsSync(push.output)) {
    if (refusedDataLoss(push.output) && !isEmpty) {
      putBack();
      if (!flag("AUTO_DB_SCHEMA_SYNC_FORCE", false)) {
        error(push.output.trim());
        error(
          "This version would delete data from the database (see the warnings above), so nothing " +
            "was changed and the app was not started. Your data is as it was.",
        );
        error(
          "To go back: use the previous image tag. To go ahead and let it delete that data: start " +
            "once with AUTO_DB_SCHEMA_SYNC_FORCE=true, then remove it. A backup was made first: " +
            copy,
        );
        return { ok: false, reason: "data_loss_refused" };
      }
      log("AUTO_DB_SCHEMA_SYNC_FORCE=true: applying the change and the data loss it reports.");
      push = runPrisma(["db", "push", "--accept-data-loss"], dbUrl);
    }
    if (push.status !== 0 || !confirmsSync(push.output)) {
      error(push.output.trim() || (push.error && push.error.message) || "prisma db push failed");
      putBack();
      error("Updating the database failed, so the app was not started.");
      return { ok: false, reason: "push_failed" };
    }
  }

  const after = pendingChanges(dbUrl);
  if (!after.ok || after.sql) {
    error("After the update the database still does not match the schema:");
    error(after.ok ? after.sql : after.detail);
    putBack();
    return { ok: false, reason: "not_in_sync_after_push" };
  }

  log(isEmpty ? "Created the database tables." : "The database was updated to this version.");
  return { ok: true, reason: "updated" };
}

module.exports = { syncSchema };
