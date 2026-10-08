#!/usr/bin/env node

/**
 * The dependency audit gate: what `npm audit` is allowed to block.
 *
 * A package the running app ships is held to a hard line: any critical or high advisory fails.
 * A package only the tooling uses (ESLint, the test runner, the type checker) is a different
 * question. The running app does not load it, so a high advisory there is said on every run but
 * does not stop work; a critical one still does. (The image does carry it on disk: `prisma` is a
 * development dependency the startup `db push` needs. "Not loaded" is the claim, not "not present".)
 *
 * Why the split exists: the gate used to count every advisory the same, so a high advisory in a
 * development-only chain (`braces`, through ESLint's Next config, with no patched release) kept it
 * red for days. A permanently red gate is read as noise, and the next production advisory, six on
 * `next` itself, arrived behind the same red unnoticed.
 *
 * This is a scope, not an allowlist: no package is named anywhere in this file, and nothing in it
 * expires or goes stale. A package is production when `npm audit --omit=dev` lists it, which is a
 * fact about the dependency tree.
 *
 * Usage:
 *   node scripts/audit-gate.js                       runs both audits itself (npm run security:audit)
 *   node scripts/audit-gate.js --prod p.json --all a.json
 *                                                    judges reports a workflow has already written
 *
 * A report that is missing or malformed is a broken gate, never a clean bill of health.
 */

const { execSync } = require("child_process");
const fs = require("fs");

const BLOCKING_PRODUCTION = new Set(["critical", "high"]);
const BLOCKING_DEV_ONLY = new Set(["critical"]);
const WARNING_DEV_ONLY = new Set(["high"]);

const RANK = { critical: 4, high: 3, moderate: 2, low: 1, info: 0 };
const UNRECOGNISED = "unrecognised";

/**
 * The most severe of the readings given. A severity npm does not emit today (or none at all) is
 * not "low": a gate that cannot tell how bad something is must not call it fine, so it blocks.
 */
function strongest(...severities) {
  if (severities.some((severity) => !Object.hasOwn(RANK, severity))) return UNRECOGNISED;
  return severities.reduce((worst, severity) => (RANK[severity] > RANK[worst] ? severity : worst));
}

/**
 * The advisory behind a package: the most severe `via` entry that is an advisory and not another
 * package, or the package it is vulnerable through.
 */
function advisoryOf(vuln) {
  const via = vuln.via || [];
  const advisory = via
    .filter((entry) => entry && typeof entry === "object")
    .sort((a, b) => (RANK[b.severity] ?? -1) - (RANK[a.severity] ?? -1))[0];
  const through = via.filter((entry) => typeof entry === "string");
  return {
    title: advisory?.title ?? (through.length > 0 ? `through ${through.join(", ")}` : ""),
    url: advisory?.url ?? "",
  };
}

/** An `npm audit --json` document, or an error naming what is wrong with it. */
function validate(report, label) {
  if (!report || typeof report !== "object") {
    throw new Error(`${label} audit report is not a JSON object`);
  }
  if (report.error) {
    const detail = report.error.summary || report.error.code || "unknown error";
    throw new Error(`${label} audit failed: ${detail}`);
  }
  if (!report.vulnerabilities || typeof report.vulnerabilities !== "object") {
    throw new Error(`${label} audit report has no "vulnerabilities" object`);
  }
  if (!report.metadata || !report.metadata.vulnerabilities) {
    throw new Error(`${label} audit report has no "metadata.vulnerabilities" counts`);
  }
  return report;
}

/**
 * Judge the two audits. `prod` is `npm audit --omit=dev`, `all` is `npm audit`.
 * Returns the packages that block, the ones that only warn, and the rest as notes.
 */
function classify(prod, all) {
  validate(prod, "Production");
  validate(all, "Full");

  const production = new Set(Object.keys(prod.vulnerabilities));
  const blocking = [];
  const warnings = [];
  const notes = [];

  for (const [pkg, vuln] of Object.entries(prod.vulnerabilities)) {
    // The two audits run seconds apart and can disagree about one package; the worse reading wins.
    const severity = strongest(vuln.severity, all.vulnerabilities[pkg]?.severity ?? vuln.severity);
    const entry = { pkg, severity, scope: "production", ...advisoryOf(vuln) };
    (severity === UNRECOGNISED || BLOCKING_PRODUCTION.has(severity) ? blocking : notes).push(entry);
  }

  for (const [pkg, vuln] of Object.entries(all.vulnerabilities)) {
    if (production.has(pkg)) continue;
    const severity = strongest(vuln.severity);
    const entry = { pkg, severity, scope: "development", ...advisoryOf(vuln) };
    if (severity === UNRECOGNISED || BLOCKING_DEV_ONLY.has(severity)) blocking.push(entry);
    else if (WARNING_DEV_ONLY.has(severity)) warnings.push(entry);
    else notes.push(entry);
  }

  return { blocking, warnings, notes };
}

/** Run an audit and parse it. `npm audit` exits non-zero whenever it finds anything, so the exit code says nothing. */
function runAudit(args) {
  let stdout;
  try {
    stdout = execSync(`npm audit ${args} --json`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    stdout = error.stdout;
    if (!stdout) throw new Error(`npm audit ${args} produced no output: ${error.message}`);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`npm audit ${args} did not print JSON`);
  }
}

function readReport(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(`${label} audit report ${file} does not exist, so the scan did not run`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    throw new Error(`${label} audit report ${file} is not valid JSON`);
  }
}

/** Both audits, from the files named on the command line or by running npm. */
function loadAudits(argv) {
  const flag = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? null : argv[at + 1];
  };
  const prodFile = flag("--prod");
  const allFile = flag("--all");
  if (Boolean(prodFile) !== Boolean(allFile)) {
    throw new Error("--prod and --all go together");
  }
  if (prodFile)
    return { prod: readReport(prodFile, "Production"), all: readReport(allFile, "Full") };
  return { prod: runAudit("--omit=dev"), all: runAudit("") };
}

function describe(entry) {
  const what = entry.title ? `${entry.title} ` : "";
  return `${entry.pkg} (${entry.severity}, ${entry.scope}): ${what}${entry.url}`.trim();
}

function main() {
  let result;
  try {
    const { prod, all } = loadAudits(process.argv.slice(2));
    result = classify(prod, all);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }

  const { blocking, warnings, notes } = result;
  const lines = [];
  lines.push("## Dependency audit");
  lines.push("");
  lines.push(`- Blocking (production critical/high, development critical): ${blocking.length}`);
  lines.push(
    `- Warnings (development-only high, not loaded by the running app): ${warnings.length}`,
  );
  lines.push(`- Other advisories: ${notes.length}`);

  for (const entry of blocking) console.log(`::error::${describe(entry)}`);
  for (const entry of warnings) console.log(`::warning::${describe(entry)}`);
  for (const entry of notes) console.log(`note: ${describe(entry)}`);

  if (warnings.length > 0) {
    lines.push("", "### Development-only warnings", "");
    for (const entry of warnings) lines.push(`- ${describe(entry)}`);
  }
  if (blocking.length > 0) {
    lines.push("", "### Blocking", "");
    for (const entry of blocking) lines.push(`- ${describe(entry)}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  }

  console.log(lines.join("\n"));
  if (blocking.length > 0) {
    console.error(
      `\n${blocking.length} blocking advisor${blocking.length === 1 ? "y" : "ies"}: ` +
        "fix it in package.json (an upgrade or an `overrides` entry), not in this script.",
    );
    process.exit(1);
  }
}

module.exports = { classify, loadAudits, advisoryOf };

if (require.main === module) main();
