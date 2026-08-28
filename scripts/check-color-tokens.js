#!/usr/bin/env node
/**
 * Advisory design-token audit.
 *
 * Flags hardcoded Tailwind color literals in components/ and app/ that should
 * instead use the semantic design tokens defined in app/globals.css
 * (`var(--color-*)` via `bg-[var(--color-success)]`, the Badge
 * `success|warning|destructive|info` variants, etc.). Two kinds are caught:
 *   - semantic literals (`bg-red-500`, `text-green-400`) — wrong hue channel;
 *   - neutral literals (`bg-zinc-900`, `text-zinc-400`) — these DON'T remap per
 *     theme, so they render dark-on-dark in the light and OLED themes. This is
 *     the higher-severity class: it silently breaks the non-default themes.
 *
 * This is intentionally NON-BLOCKING: it prints a report and always exits 0, so
 * it never breaks CI on the existing backlog. Use it to ratchet the count down
 * over time. Run with `--strict` to fail when the count exceeds BASELINE.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["components", "app"];
const COLOR_FAMILIES =
  "red|green|blue|amber|yellow|purple|violet|indigo|emerald|rose|orange|pink|fuchsia|sky|cyan|teal|lime|" +
  // Neutrals — these are the theme-breakers: they never remap for light/OLED.
  "zinc|slate|gray|neutral|stone";
const UTILITY = "bg|text|border|ring|from|to|via|fill|stroke|shadow|divide|outline|decoration";
const PATTERN = new RegExp(`\\b(?:${UTILITY})-(?:${COLOR_FAMILIES})-[0-9]{2,3}\\b`, "g");

// Files where multi-color literals are intentional (illustrations, dev tooling).
const ALLOWLIST = [
  "empty-state-illustrations",
  "scenario-runner",
  "opengraph-image",
  "/charts/",
  // Marketing landing page — intentionally brand-tinted, not token-driven.
  path.join("app", "[locale]", "page.tsx"),
];

/**
 * Baseline count — the ratchet ceiling for `--strict`. Lower this as you migrate.
 * Raised from 639 (semantic-only) to 1192 when neutral families were added to the
 * scan, net of the flagship-screen migration (property list/detail/sheet,
 * financials). Every token migration should drive this number DOWN.
 *
 * 1192 → 596: the dark-palette neutrals (`bg-zinc-900`, `text-zinc-400`,
 * `border-zinc-800`…) were not merely unidiomatic, they rendered dark-on-light —
 * Intelligence › Reports was white text on a cream page. Mapped to the semantic
 * tokens across `components/**`, skipping lines that already carry a `dark:` pair
 * and the two surfaces whose dark ground is deliberate (the locale overlay on the
 * landing hero, and the map's own tiles).
 *
 * 596 → 591: net of the Documents category chips gaining explicit `dark:` pairs
 * (+2, a real contrast fix) and the Leases selection chrome — the bulk-actions bar
 * and selected-row tint — dropping its dark-only indigo literals for the semantic
 * `--color-info` pair, which is the same dark-on-light bug one screen further in.
 *
 * 591 → 571: deleting the three views orphaned by d5d01d9 (the portfolio restructure)
 * and never removed — Contracts, Buildings and Invoices. None had an importer; the
 * first two sat behind routes that redirect elsewhere.
 */
// Tightened 571 → 560 on 2026-08-17, when this checker was first wired into `verify:ci`. It had
// never run, so the baseline had drifted 11 above the real count and the ratchet had 11 units of
// slack it was never meant to have. Lower this whenever the count drops; never raise it.
// 560 → 556 on 2026-08-22. Two of those came from `skeleton.tsx`, which carried
// `from-zinc-700 via-zinc-600 to-zinc-700` on an element whose background was already being set
// twice over — so the stops never rendered, making it dead code and a theme violation at once.
// The other two were slack: the tree measured 558 against a ceiling of 560.
const BASELINE = 556;

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, acc);
    } else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const strict = process.argv.includes("--strict");
const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d), []));

let total = 0;
const perFile = [];
for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (ALLOWLIST.some((a) => rel.includes(a))) continue;
  const matches = fs.readFileSync(file, "utf8").match(PATTERN);
  if (matches && matches.length) {
    total += matches.length;
    perFile.push({ rel, count: matches.length });
  }
}

perFile.sort((a, b) => b.count - a.count);

console.log("\nDesign-token audit — hardcoded Tailwind color literals\n");
for (const { rel, count } of perFile.slice(0, 20)) {
  console.log(`  ${String(count).padStart(4)}  ${rel}`);
}
if (perFile.length > 20) console.log(`  …and ${perFile.length - 20} more files`);
console.log(
  `\n  Total: ${total} occurrences across ${perFile.length} files (baseline ${BASELINE}).`,
);
console.log("  Prefer var(--color-*) tokens or the Badge/Button semantic variants.\n");

if (strict && total > BASELINE) {
  console.error(`✖ Color-literal count ${total} exceeds baseline ${BASELINE}. Migrate to tokens.`);
  process.exit(1);
}
process.exit(0);
