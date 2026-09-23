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
    // The MODELS and the endpoint, not the word "verification" — NIF validation, the tax
    // connectors and `timingSafeEqualString` all legitimately verify things.
    pattern:
      /`?(?:GovernmentVerification|PropertyVerificationClaim)`?|\/api\/ownership-verifications/,
    retired: "2026-09-22 (scope cutdown, phase 10)",
    because:
      "the ownership-verification scaffold was removed — two models, five enums, a service and " +
      "one endpoint, built provider-agnostic for a registry integration that never followed",
  },
  {
    // The MODEL, not the word: `PaymentAllocation` and `Tenant.paymentStatus` are the live
    // ledger and must not match. Backticked or as a Prisma relation field.
    pattern:
      /`(?:Invoice|PaymentMethod|PaymentTransaction)`|prisma\.(?:invoice|paymentMethod|paymentTransaction)\b/,
    retired: "2026-09-22 (scope cutdown, phase 9)",
    because:
      "the tenant online-payment stack was removed; rent reaches the ledger as a matched bank " +
      "movement. SAF-T PT now reads RentReceipt, and the payment alerts read RentPeriod",
  },
  {
    // Targets the CAPABILITY claim, not the two words: `app/tenant-portal/` and the token auth
    // are gone, so anything offering a tenant their own login is false.
    pattern:
      /token-gated (?:tenant )?self-service|tenant portal (?:token|link)s?\b|\/api\/tenant-portal/i,
    retired: "2026-09-22 (scope cutdown, phase 9)",
    because:
      "both tenant-facing surfaces were removed — the token portal and role=USER access to the " +
      "main app. There is no tenant login of any kind now",
  },
  {
    // The payment METHODS, which only ever existed for tenant rent collection.
    pattern: /\b(?:Multibanco|MB WAY|MBWay|Bizum)\b/i,
    retired: "2026-09-22 (scope cutdown, phase 9)",
    because:
      "the SIBS and Bizum adapters and their webhooks went with the payment stack; Stripe " +
      "survives for the app's own subscription billing only",
  },
  {
    // Narrow on purpose: "review required" also means a PR review in CONTRIBUTING.md, and
    // ROADMAP's sprint rows record what Migration D shipped, which is history rather than a
    // claim about what exists. Pin the two artifacts instead.
    pattern: /lib\/services\/ocr\/|Documents "Review Required" tab/i,
    retired: "2026-09-22 (scope cutdown, phase 8)",
    because:
      "the mock OCR classifier and DocumentExtraction went with the Documents browsing UI. " +
      "The Document model stays: receipt emission archives a PDF against it, and that copy is " +
      "the proof of a filing made at Finanças",
  },
  {
    pattern: /Brevo Inbound Parsing/i,
    retired: "2026-09-21 (scope cutdown, phase 7)",
    because:
      "inbound mail was cut in full — the webhook, InboundMessage/InboundAttachment, " +
      "lib/services/inbound/ and BREVO_INBOUND_SECRET are all gone. The delivery-event " +
      "webhook at /api/webhooks/brevo stays; it writes EmailLog for transactional mail",
  },
  {
    pattern: /Correspondence (Inbox|tab|page)/i,
    retired: "2026-09-21 (scope cutdown, phase 7)",
    because:
      "correspondence was cut in full — templates, the served-letter log, /correspondence and " +
      "the People Communications tab. Automated rent reminders survive on a separate path " +
      "(lib/services/notifications/reminder-email.ts)",
  },
  {
    pattern: /`?\/operations`? (?:is|are) live/i,
    retired: "2026-09-21 (scope cutdown, phase 5)",
    because:
      "maintenance/operations ticketing was cut in full — the MaintenanceTicket model, " +
      "/api/maintenance, the /operations and /maintenance pages and the Operations nav entry " +
      "are all gone, and there is no redirect shim left to land on",
  },
  {
    pattern: /ticket-detail-modal\.tsx/i,
    retired: "2026-09-21 (scope cutdown, phase 5)",
    because:
      "the Ticket detail modal was one of the two users of the 4-zone modal pattern and went " +
      "with the ticketing cut; tenant-detail-modal.tsx is the only one left",
  },
  {
    pattern: /maintenance-labels\.ts/i,
    retired: "2026-09-21 (scope cutdown, phase 5)",
    because:
      "the ticket status/priority label maps went with the ticketing cut; receipt-labels.ts is " +
      "the surviving example of the extract-the-map habit",
  },
  {
    pattern: /28[- ]countr(y|ies)/i,
    retired: "2026-09-21 (scope cutdown, phase 1)",
    because:
      "the theme table was trimmed to EU/PT/ES — the two markets the product serves. " +
      "countryLabel() reads Intl.DisplayNames first, so an unlisted country still renders " +
      "its name; only the theme falls back to EU",
  },
  {
    pattern: /dev-only `?\/brand`? page/i,
    retired: "2026-09-21 (scope cutdown, phase 1)",
    because:
      "the /brand style-guide page and the ⌘K command palette were deleted as dev/cosmetic surface",
  },
  {
    // The branch itself still exists and still holds two unmerged commits, so the NAME is not
    // retired — the instruction "all changes go to it" is. Pin the instruction, not the ref.
    pattern: /changes go to:?\s*\*{0,2}`?claude\/proman-design-polish-6zpz2f/i,
    retired: "2026-09-22 (repository audit)",
    because:
      "that branch sat 47 commits behind main with two unmerged commits while every session " +
      "worked somewhere else. Branching is per-change now — docs/REPOSITORY_PROCEDURES.md §1",
  },
  {
    pattern: /head branch is auto-?deleted/i,
    retired: "2026-09-22 (repository audit)",
    because:
      "it has not held consistently: #386's head branch was deleted on merge, while " +
      "release/v1.24.0 and release/v1.25.0 outlived their merged PRs (#319, #362). Check the " +
      "branch rather than assert the setting — docs/REPOSITORY_PROCEDURES.md §2",
  },
  {
    // The opposite absolute, which the audit wrote in place of the one above. Merging the PR
    // that wrote it disproved it within the hour, so neither form may come back.
    pattern: /not auto-?deleted on merge/i,
    retired: "2026-09-22 (merge of #386)",
    because:
      "#386's own head branch was deleted when it merged, with no workflow involved. Neither " +
      "absolute has held — check the branch: docs/REPOSITORY_PROCEDURES.md §2",
  },
  {
    // `feature/` only; `feat/` is the live convention and must not match.
    pattern: /`?feature\/<[a-z-]+>`?/i,
    retired: "2026-09-22 (repository audit)",
    because:
      "the prefix is `feat/`, not `feature/` — CONTRIBUTING and BRANCH_PROTECTION disagreed on " +
      "this for months. See docs/REPOSITORY_PROCEDURES.md §1",
  },
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
    because:
      'that branch has never existed — it was a "correction" of the proman-named one, which ' +
      "is itself no longer a destination for anything. Branching is per-change now: " +
      "docs/REPOSITORY_PROCEDURES.md §1",
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
  {
    pattern: /rebranding in progress to \*\*Situs/i,
    retired: "2026-09-02",
    because:
      "the rebrand is finished, and the sentence had renamed its own subject: PR #328's global " +
      "ProMan->Situs sweep rewrote 'ProMan (rebranding in progress to Situs...)' into a line " +
      "claiming Situs was being renamed to Situs. Same accident produced the ROADMAP and README " +
      "variants retired below",
  },
  {
    pattern: /Rebranded "Situs" . "Lares"/i,
    retired: "2026-09-02",
    because:
      "same blanket-rename accident in the Decisions Log: the row records renaming ProMan to " +
      "Lares, and the sweep turned it into a claim that the current name was renamed away",
  },
  {
    pattern: /full infra rename \(PR 13\)/i,
    retired: "2026-09-02",
    because:
      "PR 13 shipped as #328 — package.json, Docker and env identifiers all read situs — and " +
      "PR 10b shipped alongside it; CLAUDE.md listed both as still deferred",
  },
  {
    pattern: /SQLite, Helm chart/i,
    retired: "2026-09-02",
    because:
      "Helm and the k8s manifests were dropped for a single Docker path in #328; ROADMAP's " +
      "Completed Features went on advertising a chart that no longer exists",
  },
  {
    pattern: /PT, EN, ES locale support/i,
    retired: "2026-09-02",
    because:
      "there are four locales — messages/it.json exists and i18n:check:strict enforces it, so a " +
      "contributor following the three-locale claim fails a hygiene gate",
  },
  {
    pattern: /three locale files must stay in sync/i,
    retired: "2026-09-02",
    because:
      "the same three-vs-four error one paragraph lower in CONTRIBUTING.md — it listed en/pt/es " +
      "and told contributors to add each key to 'all three', which fails i18n:check:strict",
  },
  {
    pattern: /statusColors|borderRadius\.card/,
    retired: "2026-09-02",
    because:
      "lib/design-tokens.ts exports `tokens` plus three getters; CONTRIBUTING.md's example " +
      "imported statusColors, surfaces and borderRadius — 3 of 3 import lines named symbols " +
      "that do not exist, so the snippet could not compile",
  },
  {
    pattern: /kubectl create secret|as a Kubernetes Secret/i,
    retired: "2026-09-02",
    because:
      "there are no Kubernetes manifests and no Helm chart — both were dropped for a single " +
      "Docker path, so secrets come from the env file docker-compose reads via env_file",
  },
  {
    pattern: /UPDATE_WEBHOOK_RATE_LIMIT|UPDATE_WEBHOOK_HMAC_ONLY/,
    retired: "2026-09-02",
    because:
      "the /api/updates webhook was removed; docs/SECURITY.md documented rate-limit variables " +
      "for it seven lines below its own statement that the endpoint is gone, and .env.example " +
      "declared five more variables no code reads",
  },
  {
    pattern: /graceful-shutdown/,
    retired: "2026-09-02",
    because:
      "lib/utils/graceful-shutdown.ts does not exist and never did in this tree; the monitoring " +
      "doc documented it with a usage example, imports and all",
  },
  {
    pattern: /comprehensive overview of all API routes/i,
    retired: "2026-09-02",
    because:
      "it documented 26 of 50 domains. The count is now stated explicitly and checked below, " +
      "because the honest version of this claim is one nothing has to remember to update",
  },
  {
    pattern: /Ensure your reverse proxy or ingress adds these headers/i,
    retired: "2026-09-02",
    because:
      "proxy.ts sets every one of them on every response, including a per-request CSP nonce — " +
      "an operator following this would have concluded the app shipped with no headers at all",
  },
  {
    pattern: /SendGrid free tier: \*\*100 emails\/day\*\*|SendGrid free tier is/i,
    retired: "2026-09-02",
    because:
      "Twilio retired SendGrid's free tier on 2025-05-27 and paused unupgraded accounts on " +
      "2025-07-26; the floor is now $19.95/month. A self-hosted instance following this doc " +
      "would have configured a plan that cannot send",
  },
  {
    pattern: /SENDGRID_API_KEY|ENABLE_SENDGRID|@sendgrid\/mail/,
    retired: "2026-09-02",
    because:
      "email goes over SMTP now — one transport, any provider — so the configuration is " +
      "SMTP_HOST/PORT/USER/PASS. Naming the old variable sends an operator looking for a " +
      "setting that no code reads",
  },
  {
    pattern: /api\/webhooks\/sendgrid/,
    retired: "2026-09-02",
    because:
      "replaced by /api/webhooks/brevo. Worth knowing why the security note changed with it: " +
      "SendGrid signed events with ECDSA, Brevo signs nothing, so the new route requires a " +
      "shared secret instead of verifying a signature",
  },
  {
    // True until artillery, the load tester, was removed with its harness. The moderate csv-parse
    // advisory reached the tree only through it, so `verify:ci` stopped at security:audit and never
    // ran the tests after it — and the docs taught sessions to expect that.
    pattern: /security:audit\W{0,4} exits non-zero|csv-parse\W{0,2} advisory/i,
    retired: "2026-09-23 (stale docs and dead code)",
    because:
      "artillery was the only path to that advisory and is gone; npm audit reports 0 " +
      "vulnerabilities, so a security:audit failure is now a finding to fix, not a known state",
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
  // Two historical records, not claims about what exists. A changelog entry for a shipped
  // version stays true about that version, and a dated Decisions Log row records what was
  // decided on the day. Both name the payment methods phase 9 removed; neither offers them.
  /Full payment integration for Portugal and Spain markets/,
  /Keep MB WAY\/Bizum as documented placeholders/,
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
