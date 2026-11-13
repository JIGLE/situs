// @vitest-environment node
import { execSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The schema step of the container's start: an update must reach an older database on its own,
 * and must never cost it data. These run the real Prisma CLI against throwaway SQLite files.
 *
 * What is not here: the AUTO_DB_SCHEMA_SYNC_FORCE path's real `--accept-data-loss` push. Prisma
 * refuses that flag when an AI agent runs it, and the step that matters (a refused change leaves
 * the file alone) is covered without it.
 */

const require = createRequire(import.meta.url);
const { syncSchema } = require("./schema-sync.js") as {
  syncSchema: (opts: {
    dbFile: string;
    dbUrl: string;
    log: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
    prisma?: string | null;
  }) => { ok: boolean; reason: string };
};
const Database = require("better-sqlite3");

let dir: string;
let current: string; // a database on today's schema, with rows

const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function sync(file: string, prisma: string | null = null) {
  const lines: string[] = [];
  const result = syncSchema({
    dbFile: file,
    dbUrl: `file:${file}`,
    log: (...a) => lines.push(a.join(" ")),
    error: (...a) => lines.push(a.join(" ")),
    prisma,
  });
  return { ...result, log: lines.join("\n") };
}

function copyOf(name: string) {
  const file = path.join(dir, name, "situs.sqlite");
  execSync(`mkdir -p "${path.dirname(file)}"`);
  copyFileSync(current, file);
  return file;
}

const backups = (file: string) => {
  try {
    return readdirSync(path.join(path.dirname(file), "backups"));
  } catch {
    return [];
  }
};

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "situs-schema-sync-"));
  current = path.join(dir, "current.sqlite");
  execSync(`npx prisma db push --url="file:${current}"`, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${current}` },
    stdio: "pipe",
  });
  const db = new Database(current);
  db.prepare(
    "INSERT INTO User (id, email, name, updatedAt) VALUES ('u1', 'owner@example.com', 'Owner', 0)",
  ).run();
  db.prepare(
    "INSERT INTO properties (id, userId, name, address, type, rent, status, updatedAt) " +
      "VALUES ('p1', 'u1', 'Casa', 'Rua 1', 'apartment', 900, 'occupied', 0)",
  ).run();
  db.close();
}, 120_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("schema sync on start", () => {
  it("leaves an up-to-date database alone, without a backup", () => {
    const file = copyOf("in-sync");
    const before = hash(file);

    const result = sync(file);

    expect(result).toMatchObject({ ok: true, reason: "in_sync" });
    expect(hash(file)).toBe(before);
    expect(backups(file)).toEqual([]);
  }, 60_000);

  it("brings an older database up to date, keeps its rows, and backs it up first", () => {
    const file = copyOf("older");
    const db = new Database(file);
    db.exec("DROP TABLE owner_payouts; ALTER TABLE properties DROP COLUMN permilage;");
    db.close();

    const result = sync(file);

    expect(result).toMatchObject({ ok: true, reason: "updated" });
    const after = new Database(file, { readonly: true });
    expect(after.prepare("SELECT name, permilage FROM properties").all()).toEqual([
      { name: "Casa", permilage: null },
    ]);
    expect(
      after.prepare("SELECT name FROM sqlite_master WHERE name = 'owner_payouts'").get(),
    ).toBeTruthy();
    after.close();

    const [copy] = backups(file);
    expect(copy).toMatch(/^situs-before-update-.*\.sqlite$/);
    const old = new Database(path.join(path.dirname(file), "backups", copy), { readonly: true });
    expect(old.prepare("SELECT name FROM properties").all()).toEqual([{ name: "Casa" }]);
    old.close();
  }, 60_000);

  it("refuses an update that would delete data, and changes nothing", () => {
    const file = copyOf("data-loss");
    const db = new Database(file);
    db.exec(
      "ALTER TABLE properties ADD COLUMN legacyNote TEXT; UPDATE properties SET legacyNote = 'keep';",
    );
    db.close();
    const before = hash(file);

    const result = sync(file);

    expect(result).toMatchObject({ ok: false, reason: "data_loss_refused" });
    expect(result.log).toContain("AUTO_DB_SCHEMA_SYNC_FORCE=true");
    expect(hash(file)).toBe(before);
    expect(backups(file)).toHaveLength(1);

    // TrueNAS restarts a container that exits; the retry reuses the copy rather than adding one.
    expect(sync(file).reason).toBe("data_loss_refused");
    expect(backups(file)).toHaveLength(1);
  }, 120_000);

  it("puts the backup back when the update fails halfway", () => {
    const file = copyOf("half-applied");
    const db = new Database(file);
    db.exec("ALTER TABLE properties DROP COLUMN permilage;");
    db.close();

    // Real Prisma for the diff; a push that writes to the file and then dies.
    const realCli = require.resolve("prisma/build/index.js");
    const stub = path.join(dir, "half-applied-prisma.js");
    writeFileSync(
      stub,
      `const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
if (args[0] === "db" && args[1] === "push") {
  const Database = require(${JSON.stringify(require.resolve("better-sqlite3"))});
  const db = new Database(${JSON.stringify(file)});
  db.exec("CREATE TABLE half_applied (id TEXT); DROP TABLE properties;");
  db.close();
  console.error("Error: something went wrong partway");
  process.exit(1);
}
const r = spawnSync(process.execPath, [${JSON.stringify(realCli)}, ...args], { stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
`,
    );

    const result = sync(file, stub);

    expect(result).toMatchObject({ ok: false, reason: "push_failed" });
    expect(result.log).toContain("put back");
    // The copy is a VACUUM of the file, so compare what it holds rather than its bytes.
    const after = new Database(file, { readonly: true });
    expect(after.prepare("SELECT name FROM properties").all()).toEqual([{ name: "Casa" }]);
    expect(
      after.prepare("SELECT name FROM sqlite_master WHERE name = 'half_applied'").get(),
    ).toBeUndefined();
    after.close();
  }, 60_000);
});
