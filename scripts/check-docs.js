#!/usr/bin/env node
/**
 * Documentation hygiene gate.
 *
 * Three assertions, each of which has already been violated in this repo:
 *
 *   1. LINKS — every relative link in every tracked `.md` resolves. 48 were broken before this
 *      existed. This is also what makes deleting a doc safe: the deletion fails loudly instead of
 *      leaving dangling references behind.
 *
 *   2. ORPHANS — every file under `docs/` is reachable from `docs/README.md`, the root `README.md`
 *      or `CLAUDE.md`. 24 were reachable from nothing. Three of those documented live code, so the
 *      lesson is not "delete unreferenced files" — it is "index them, and notice when you can't".
 *
 *   3. RETIRED CLAIMS — sentences known to be false stay deleted. `V1_CHECKLIST` said "No live
 *      bank connection exists" for one merge after it stopped being true, because a claim about
 *      what exists has an expiry and nothing was watching it.
 *
 * WHY IT FAILS WHEN IT CANNOT RUN. A checker that finds no files and exits 0 is the repo's
 * signature bug — the green-but-inert job, four instances of it so far. If the index is missing or
 * the scan finds nothing, that is a failure, not a pass.
 *
 * Link resolution deliberately allows two forms: relative to the document, and relative to the
 * repo root. Several docs cite code as `lib/services/…` or `proxy.ts`, meaning "from the root",
 * which is a reasonable convention and not worth 17 rewrites to satisfy a checker.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const INDEX = "docs/README.md";

/** Files under docs/ that need no index entry, with the reason they are exempt. */
const INDEX_EXEMPT = new Set([
  "docs/README.md", // it is the index
]);

/**
 * Sentences that were true once and are now false. Add a line here in the same commit that makes
 * one false — that is the moment someone is already looking at the relevant code.
 */
const RETIRED_CLAIMS = [
  {
    pattern: /no provider ships/i,
    retired: "2026-08-28 (PR #352)",
    because:
      "the Enable Banking adapter shipped in PR #340; docs/README.md kept telling readers that " +
      "CSV import was the only path, which is the exact shape of claim rule 3 exists to catch",
  },
  {
    pattern: /No live bank connection exists/i,
    retired: "2026-08-17 (PR #334)",
    because:
      "PSD2 account information shipped; /admin derives bank status from the connection rows",
  },
  {
    pattern: /claude\/situs-design-polish-6zpz2f/,
    retired: "2026-08-17",
    because: "that branch has never existed; the real one is claude/proman-design-polish-6zpz2f",
  },
  {
    pattern: /GHSA-c96f-x56v-gq3h/,
    retired: "2026-08-18",
    because:
      "find-my-way was fixed by an overrides entry; the audit allowlist that carried this " +
      "advisory is gone from security-scan.yml, and it swallowed a real finding before it went",
  },
  {
    // The subdomain token, not the full host `bankaccountdata.gocardless.com`. CodeQL flagged
    // that form as `js/incomplete-hostname-regexp` (High) — right about the shape, wrong about
    // the use, since this greps prose rather than validating a URL. Rather than suppress the
    // rule, drop the shape: nothing but that dashboard is ever written as one word, so the token
    // catches the bare host and any URL around it. Deliberately NOT widened to the spaced form
    // "Bank Account Data" — that is the product's name, and CLAUDE.md is entitled to use it in
    // the sentence recording why the adapter was removed.
    pattern: /bankaccountdata/i,
    retired: "2026-08-20",
    because:
      "GoCardless closed Bank Account Data to new signups in July 2025, so telling an operator " +
      "to create credentials there sends them somewhere they cannot sign up",
  },
  {
    // Same shape as the base64 entry below: the correction has to name Sandbox in order to warn
    // against it, so this matches the recommendation — sandbox offered as the thing to begin with
    // — and the allowlist carries the warning's own phrasing.
    pattern: /start with a sandbox|sandbox (application |app )?first|begin with a sandbox/i,
    retired: "2026-08-20",
    because:
      "a Sandbox application reaches only Enable Banking's Mock ASPSP — a synthetic bank whose " +
      "accounts you define yourself — and the connect picker offers only PT and ES, so sandbox " +
      "leaves it empty. Register a Production application in restricted mode to connect a real " +
      "bank. (An earlier version of this entry said the sandbox holds Nordic banks. That was " +
      "generalised from one sample file hardcoding Nordea/FI and was wrong about what sandbox is.)",
  },
  {
    // Targets the RECOMMENDATION, not the word. The correction has to be able to say "base64"
    // in order to warn against it, so the pattern requires the shape the advice took — base64
    // offered as the way to get a key into a config field — and CLAIM_ALLOWLIST carries the
    // three phrasings the warning uses.
    pattern: /base64.{0,60}(env|config|app-config|truenas).{0,25}(field|value|variable)/i,
    retired: "2026-08-20",
    because:
      "measured: a PEM is ~1,700 chars and base64 makes it ~2,272 against TrueNAS' 1,000-char " +
      "cap, so base64 is strictly worse than the thing it was offered to fix; the key is mounted " +
      "as a file via ENABLE_BANKING_PRIVATE_KEY_FILE instead",
  },
  {
    pattern: /connect a bank.{0,40}gocardless|gocardless.{0,40}connect a bank/i,
    retired: "2026-08-20",
    because: "the adapter was removed; the registry ships empty and CSV import is the path",
  },
];

/** Lines allowed to mention a retired claim, because they are the record of its retirement. */
const CLAIM_ALLOWLIST = [
  /previously read/i,
  /never existed/i,
  /Do not "correct"/i,
  /Not a Sandbox one/i, // the warning has to name what it warns against
  /cannot exercise this app|can never populate/i,
  /Do not base64/i,
  /no encoding fits/i,
  /makes it (worse|~?2,272)/i,
  /RETIRED_CLAIMS/, // this file
  /retired:/,
];

const LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const EXTERNAL = /^(https?:|mailto:|tel:|data:|#)/;

function tracked() {
  const out = execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function exists(p) {
  try {
    fs.statSync(path.join(ROOT, p));
    return true;
  } catch {
    return false;
  }
}

const failures = [];

// ---------------------------------------------------------------- preconditions

const files = tracked();
if (files.length === 0) {
  console.error("✖ No tracked .md files found. The scan cannot have run correctly.");
  process.exit(1);
}
if (!exists(INDEX)) {
  console.error(`✖ ${INDEX} is missing. It is the index every doc must be reachable from.`);
  process.exit(1);
}

// ---------------------------------------------------------------- 1. links

let linksChecked = 0;
for (const file of files) {
  const dir = path.dirname(file);
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const m of text.matchAll(LINK)) {
    const target = m[1].split("#")[0].trim();
    if (!target || EXTERNAL.test(target)) continue;
    linksChecked += 1;
    const fromDoc = path.normalize(path.join(dir, target));
    const fromRoot = path.normalize(target.replace(/^\.\//, ""));
    if (exists(fromDoc) || exists(fromRoot)) continue;
    failures.push(`${file}: link does not resolve → ${target}`);
  }
}
if (linksChecked === 0) {
  console.error("✖ Zero links checked across every doc. The link scan is not working.");
  process.exit(1);
}

// ---------------------------------------------------------------- 2. orphans

const indexText =
  fs.readFileSync(path.join(ROOT, INDEX), "utf8") +
  (exists("README.md") ? fs.readFileSync(path.join(ROOT, "README.md"), "utf8") : "") +
  (exists("CLAUDE.md") ? fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8") : "");

const docsFiles = files.filter((f) => f.startsWith("docs/"));
if (docsFiles.length === 0) {
  console.error("✖ No files found under docs/. The orphan scan is not working.");
  process.exit(1);
}
for (const file of docsFiles) {
  if (INDEX_EXEMPT.has(file)) continue;
  const relToDocs = file.slice("docs/".length);
  if (indexText.includes(relToDocs) || indexText.includes(file)) continue;
  failures.push(`${file}: not reachable from ${INDEX} — add the link in this commit`);
}

// ---------------------------------------------------------------- 3. retired claims

for (const file of files) {
  const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const claim of RETIRED_CLAIMS) {
      if (!claim.pattern.test(line)) continue;
      if (CLAIM_ALLOWLIST.some((ok) => ok.test(line))) continue;
      failures.push(
        `${file}:${i + 1}: retired claim (${claim.retired}) — ${claim.because}\n      ${line.trim()}`,
      );
    }
  });
}

// ---------------------------------------------------------------- report

console.log("\nDocumentation hygiene\n");
console.log(`  ${files.length} tracked .md files`);
console.log(`  ${linksChecked} relative links checked`);
console.log(`  ${docsFiles.length} files under docs/, ${INDEX_EXEMPT.size} exempt from the index`);
console.log(`  ${RETIRED_CLAIMS.length} retired claims watched\n`);

if (failures.length > 0) {
  console.error(`✖ ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`   ${f}`);
  console.error("");
  process.exit(1);
}

console.log("  All clear.\n");
process.exit(0);
