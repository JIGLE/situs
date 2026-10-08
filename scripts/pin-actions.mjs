#!/usr/bin/env node
/**
 * Pin third-party GitHub Actions to commit SHAs.
 *
 * A tag like `@v4` is a mutable pointer the upstream owner can move at any time, at which
 * point every workflow here starts running different code with the same reference. A commit
 * SHA cannot be moved. This rewrites third-party `uses:` lines to
 *
 *     uses: owner/repo@<40-char-sha> # v4
 *
 * keeping the human-readable version in a trailing comment. Dependabot understands this
 * format and keeps bumping both parts (see .github/dependabot.yml).
 *
 * Every action is pinned, those under `actions/` and `github/` too. They are the platform's own,
 * but a tag is still a pointer the owner of that account can move, and the cost of a pin is a
 * trailing comment that Dependabot keeps current.
 *
 * Tags are resolved with `git ls-remote`, which needs no API token and has no rate limit, so it
 * runs wherever git can reach github.com. A ref that is no tag but a branch (the dependency
 * review action publishes `v5` that way) resolves to the branch's commit.
 *
 * Usage:
 *   node scripts/pin-actions.mjs            # rewrite in place
 *   node scripts/pin-actions.mjs --check    # exit 1 if anything is unpinned (CI-friendly)
 *
 */

import { execFile } from "node:child_process";
import { readFile, writeFile, glob } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

// `owner/repo`, optionally followed by a path inside it (`github/codeql-action/init`).
const USES_RE = /^(\s*(?:-\s*)?uses:\s*)([\w.-]+\/[\w.-]+(?:\/[\w./-]+)?)@([^\s#]+)(\s*#.*)?$/;

const checkOnly = process.argv.includes("--check");

const isSha = (ref) => /^[0-9a-f]{40}$/.test(ref);

const cache = new Map();

/** The commit a tag (or, failing that, a branch) names, in `owner/repo`'s own history. */
async function resolveSha(repo, ref) {
  const key = `${repo}@${ref}`;
  if (cache.has(key)) return cache.get(key);

  const [owner, name] = repo.split("/");
  const { stdout } = await run("git", [
    "ls-remote",
    `https://github.com/${owner}/${name}.git`,
    `refs/tags/${ref}`,
    `refs/tags/${ref}^{}`,
    `refs/heads/${ref}`,
  ]);
  const found = new Map(
    stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t").reverse()),
  );
  // An annotated tag points at a tag object, whose `^{}` entry is the commit `uses:` resolves
  // against; a lightweight tag and a branch point at the commit directly.
  const sha =
    found.get(`refs/tags/${ref}^{}`) ??
    found.get(`refs/tags/${ref}`) ??
    found.get(`refs/heads/${ref}`);

  if (!isSha(sha)) throw new Error(`${key}: no tag or branch of that name (got '${sha}')`);
  cache.set(key, sha);
  return sha;
}

// Every YAML file under .github, whatever its extension or depth: GitHub loads `.yaml` as well,
// and a composite action may sit deeper than one directory.
const files = [];
for (const pattern of [".github/**/*.yml", ".github/**/*.yaml"]) {
  for await (const f of glob(pattern)) files.push(f);
}
files.sort();

// What follows a `uses:` key, quoted or not, wherever on the line the key stands (a block
// mapping, a list item, a flow mapping). A comment line has none.
const USES_VALUE_RE = /\buses\s*:\s*["']?([^\s"'#,}]+)/;
const isLocal = (value) => value.startsWith("./") || value.startsWith("docker://");
const isPinned = (value) => /@[0-9a-f]{40}$/.test(value);

let unpinned = 0;
let rewritten = 0;
let seen = 0;
const failures = [];

for (const file of files) {
  const original = await readFile(file, "utf8");
  const lines = original.split("\n");
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    if (line.trimStart().startsWith("#")) continue;
    const value = USES_VALUE_RE.exec(line)?.[1];
    if (value === undefined) continue;
    seen++;
    if (isLocal(value) || isPinned(value)) continue;

    unpinned++;
    if (checkOnly) {
      console.log(`unpinned  ${file}:${i + 1}  ${value}`);
      continue;
    }

    // Only the plain `uses: owner/repo@ref # comment` form is rewritten; any other spelling of a
    // reference is for a person to fix, since a wrong guess about it would pin nothing.
    const m = USES_RE.exec(line);
    if (!m) {
      failures.push(
        `${file}:${i + 1}  ${value}: not in the form the script rewrites; pin it by hand`,
      );
      continue;
    }
    const [, prefix, repo, ref, comment = ""] = m;

    try {
      const sha = await resolveSha(repo, ref);
      // Preserve any existing trailing comment that is not our own version marker.
      const extra = comment.trim().replace(/^#\s*/, "");
      const note = extra && extra !== ref ? `${ref} (${extra})` : ref;
      lines[i] = `${prefix}${repo}@${sha} # ${note}`;
      console.log(`pinned    ${file}:${i + 1}  ${repo}@${ref} -> ${sha.slice(0, 12)}…`);
      changed = true;
      rewritten++;
    } catch (err) {
      failures.push(`${file}:${i + 1}  ${err.message}`);
    }
  }

  if (changed) await writeFile(file, lines.join("\n"));
}

if (files.length === 0 || seen === 0) {
  // A gate that finds nothing to judge has not run.
  console.error("No `uses:` reference found under .github; the search is broken.");
  process.exit(1);
}

if (failures.length) {
  console.error("\nCould not resolve:");
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

if (checkOnly) {
  if (unpinned) {
    console.error(`\n${unpinned} action(s) still on a mutable tag.`);
    console.error("Run: node scripts/pin-actions.mjs");
    process.exit(1);
  }
  console.log("Every action is pinned to commit SHAs.");
} else {
  console.log(`\n${rewritten} reference(s) pinned.`);
}
