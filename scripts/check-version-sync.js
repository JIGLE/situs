#!/usr/bin/env node
/**
 * `public/version.json` must agree with `package.json`.
 *
 * It did not. The file said `1.3.0` against a shipped `1.24.0` — twenty-one releases of drift,
 * displayed to the user in Settings › Account, in the update banner, and in the version badge.
 *
 * The cause was a comment. `app/api/info/route.ts` states that `public/version.json` "carries the
 * same three values as a static file, written at build time" — and nothing wrote it. Nothing ever
 * had. A claim about a mechanism that does not exist is worse than no claim: it tells the next
 * reader the number maintains itself, so nobody checks it. That is `CLAUDE.md` hygiene rule 3
 * with the artefact in code rather than in prose.
 *
 * Two modes, because one alone would not hold:
 *
 *   --write   regenerate the file. `prebuild` runs this, so a built image cannot ship a stale one.
 *   (default) fail if the committed file disagrees. `npm run hygiene` runs this, because
 *             `npm run dev` never runs `prebuild` — without the check a developer's Settings page
 *             would still show whatever the file last happened to contain.
 */

const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..");
const TARGET = join(ROOT, "public", "version.json");

const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const write = process.argv.includes("--write");

// Kept to exactly the shape the three consumers read (`update-banner.tsx`, `version-badge.tsx`,
// `settings-view.tsx` all take `.version`). Build metadata belongs to `/api/info`, which reads it
// from the environment the image was built with; duplicating it into a committed file would just
// create a second thing to drift.
const desired = `${JSON.stringify({ version }, null, 2)}\n`;

let current = null;
try {
  current = readFileSync(TARGET, "utf8");
} catch {
  /* missing counts as out of sync */
}

if (write) {
  if (current !== desired) {
    writeFileSync(TARGET, desired);
    console.log(`[version-sync] wrote public/version.json → ${version}`);
  }
  process.exit(0);
}

if (current === desired) {
  console.log(`[version-sync] public/version.json matches package.json (${version})`);
  process.exit(0);
}

let found = "missing";
try {
  found = JSON.parse(current).version ?? "absent";
} catch {
  found = "unparseable";
}

console.error(
  `✖ public/version.json says ${found}, package.json says ${version}.\n` +
    `  This number is shown to the user in Settings › Account, the update banner and the version\n` +
    `  badge. Run \`npm run version:sync\` to regenerate it.`,
);
process.exit(1);
