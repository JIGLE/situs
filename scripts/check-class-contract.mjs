#!/usr/bin/env node
/**
 * The class contract: every class used is defined, every class defined is used.
 *
 * This exists because of a bug that was invisible in review. `animate-in`, `animate-out`,
 * `fade-in-0`, `zoom-in-95` and `slide-in-from-*` are the vocabulary every shadcn/Radix overlay is
 * written in — but they ship in `tailwindcss-animate`, a Tailwind 3 plugin that was never installed
 * here. Tailwind drops an unknown utility silently, so six primitives (dialog, alert-dialog,
 * dropdown-menu, select, sheet, notification-center) carried the classes, none of them animated,
 * and nothing anywhere said so. It surfaced only when a person noticed modals appearing without
 * motion.
 *
 * A class that does nothing looks exactly like a class that works. That is the whole problem, and
 * it runs in both directions:
 *
 *   USED BUT NOT DEFINED  — the bug above.
 *   DEFINED BUT NOT USED  — dead CSS in `globals.css`.
 *
 * Both are blocking at zero. The second started at 43 and was meant to be a ratchet, but the
 * backlog turned out to be one sitting: 43 rules nothing referenced, including four that shadowed
 * real Tailwind utilities with different behaviour. A ceiling above zero is an invitation, and
 * there is nothing left to invite.
 *
 * WHY TAILWIND ITSELF IS THE ORACLE. There is no hand-maintained list of valid utilities here, and
 * there must never be one — it would drift the moment Tailwind adds a utility or the theme changes
 * a token. Instead the candidate tokens are handed to the real compiler via `@source inline(…)`
 * and we read back which ones produced a rule. Whatever Tailwind generates is by definition valid;
 * whatever it skips is not. That also means this checker keeps working across Tailwind upgrades
 * without being touched.
 *
 * Advisory by default (exit 0). `--strict` fails when either direction exceeds its baseline.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["components", "app"];
const GLOBALS = path.join(ROOT, "app", "globals.css");

/**
 * Ceilings for `--strict`. Both are zero and both must stay there.
 *
 * Raising either is not a fix. A class the compiler cannot build, or a rule nothing references,
 * is the finding — not the threshold.
 */
const BASELINE = { undefined: 0, unused: 0 };

/**
 * Classes that are defined here but consumed somewhere this scan cannot see, or are deliberately
 * held. Each needs a reason — "probably used somewhere" is what this checker exists to disprove.
 */
const UNUSED_ALLOWLIST = new Set([
  // Applied by next-themes / the theme script to <html> before React hydrates, so it never
  // appears in a className in source.
  "dark",
  "dark-oled",
]);

/**
 * Tokens that are real classes but come from outside this codebase, so Tailwind will not generate
 * them and `globals.css` does not define them. Without this they read as "used but not defined".
 */
const UNDEFINED_ALLOWLIST = [
  /^leaflet-/, // Leaflet injects its own stylesheet
  /^rdp-/, // react-day-picker
  /^recharts-/,
  /^swiper-/,
  /^sr-only$/, // Tailwind ships it, but keep it explicit — it is load-bearing for a11y
  // Markers, not utilities: `group` and `peer` produce no rule of their own — they are what the
  // `group-hover:`/`peer-checked:` variants hook onto. Tailwind generating nothing for them is
  // correct, so the oracle cannot see them and never will.
  /^(group|peer)$/,
  /^(group|peer)\//, // named variants: `group/row`, `peer/email`
];

// ── collection ────────────────────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/*
 * The two directions read the same literals through different filters.
 *
 * Direction A wants PRECISION — a false positive is a spurious build failure — so it reports only
 * tokens that two independent signals agree are classes (see `classListsOnly` and
 * `hasVariantShape`).
 *
 * Direction B wants RECALL: failing to see a usage means calling a live class dead, and deleting
 * it breaks styling silently. So it counts a class as used if the token appears in ANY string
 * literal, class list or not. `const baseClasses = "bg-[var(--color-muted)] animate-shimmer"` has
 * to count, and so does a class named in a test assertion.
 *
 * String literals only, in both directions. An earlier pass used a bare word-boundary grep and
 * counted the word "panel" in a code comment as proof that `.panel` was in use.
 */

/**
 * 2000, not 400. The first cap silently skipped the longest `className` strings in the tree —
 * `dropdown-menu.tsx` writes its whole base style as one 500-character literal — which took every
 * class in them out of both directions at once.
 */
const LITERAL = /["'`]([^"'`\n]{0,2000})["'`]/g;

/**
 * Blank out `//` and block comments before anything else looks at the source.
 *
 * Prose is not markup, and this codebase writes a lot of prose about classes. A comment naming a
 * class in backticks is indistinguishable from a template literal to a regex, which cuts both
 * ways: Direction A reported `hover:r-4` from the very comment explaining why `hover:r-4` had been
 * removed, and Direction B would count a class mentioned only in a comment as proof it is still
 * in use — the exact mistake the word "panel" in a comment caused when this scan was a grep.
 *
 * Strings are walked rather than skipped over, so a `//` inside a URL stays a URL.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += source[i];
        i++;
        if (source[i - 1] === quote) break;
      }
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Every string literal in the file, tokenised, as candidate class lists.
 *
 * Deliberately does NOT try to identify which literals are class attributes. Anchoring on
 * `className`/`cn`/`cva` and taking a window after them was the first attempt and it was hopeless:
 * a window swallows the next URL, SVG path and object key too, and Direction A drowned in 1,229
 * false positives — `018-8V0C5.373`, `/api/portal/owner-contact`, `.map(([type,`. Walking balanced
 * brackets instead of a window is the same mistake in a new coat: it has to survive an apostrophe
 * inside a comment, and when it does not it swallows the next JSX subtree — 88 false positives,
 * `React.Children.only` among them.
 *
 * The discrimination happens later instead, and self-calibrates: see `classListsOnly`.
 */
function extractStringLiterals(source, shaped) {
  const literals = [];
  for (const [, body] of stripComments(source).matchAll(LITERAL)) {
    if (!body || body.includes("${")) continue;
    const tokens = [];
    for (const raw of body.split(/\s+/)) {
      if (!raw || raw.length > 120) continue;
      const token = normalize(raw);
      if (!token) continue;
      tokens.push(token);
      if (hasVariantShape(raw)) shaped.add(token);
    }
    if (tokens.length) literals.push(tokens);
  }
  return literals;
}

/**
 * Decide which literals were class lists, and return only the tokens that failed to resolve.
 *
 * The test is proportional, not structural: if most of a literal's tokens are classes Tailwind
 * can build, the literal is a class list and the stragglers are suspect. If almost none are, it
 * was never a class list — an SVG path, a URL, a sentence — and nothing in it is reported.
 *
 * `MIN_TOKENS` of 2 keeps single-word strings out; a lone `"active"` or `"draft"` is a status
 * value far more often than a utility.
 */
function classListsOnly(literals, isResolvable) {
  const MIN_TOKENS = 2;
  const MIN_RESOLVED_RATIO = 0.6;
  const suspects = new Set();

  for (const tokens of literals) {
    if (tokens.length < MIN_TOKENS) continue;
    const resolved = tokens.filter(isResolvable);
    if (resolved.length / tokens.length < MIN_RESOLVED_RATIO) continue;
    for (const token of tokens) if (!isResolvable(token)) suspects.add(token);
  }
  return suspects;
}

/**
 * ── the second signal: variant shape ──────────────────────────────────────────────────────────
 *
 * The ratio test has one blind spot, and it is not hypothetical — it hid a live bug. A literal in
 * which EVERY token is broken scores a ratio of zero and is dismissed as "not a class list", which
 * is exactly backwards. `dialog.tsx` carries
 * `"data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]"` as its
 * own `cn()` argument: two tokens, both undefined, and the whole literal read as prose. The dialog
 * had been sliding from nowhere ever since.
 *
 * Shape is the signal that needs no surrounding context. `data-[state=open]:`, `group-hover:`,
 * `max-md:` — a token wearing a Tailwind variant prefix in front of a utility-shaped base is a
 * class no matter what else shares its string, so it is judged on its own. A URL survives this
 * because `https:` is not a variant and `//api.example.com` is not a utility.
 */
const KNOWN_VARIANTS = new Set([
  "hover",
  "focus",
  "focus-visible",
  "focus-within",
  "active",
  "visited",
  "target",
  "disabled",
  "enabled",
  "checked",
  "indeterminate",
  "required",
  "valid",
  "invalid",
  "read-only",
  "placeholder-shown",
  "autofill",
  "open",
  "dark",
  "light",
  "print",
  "rtl",
  "ltr",
  "motion-safe",
  "motion-reduce",
  "contrast-more",
  "contrast-less",
  "forced-colors",
  "portrait",
  "landscape",
  "starting",
  "first",
  "last",
  "only",
  "odd",
  "even",
  "first-of-type",
  "last-of-type",
  "only-of-type",
  "empty",
  "before",
  "after",
  "placeholder",
  "file",
  "marker",
  "selection",
  "backdrop",
  "first-letter",
  "first-line",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
]);

/** Variants that take an argument, so they are recognised by their prefix rather than by name. */
const PARAMETRIC_VARIANT = /^(?:group|peer|has|not|in|aria|data|supports|nth|min|max|\*|@)[-[]/;

/** A base that could be a utility: starts like an identifier, not like a path or a number. */
const UTILITY_SHAPE = /^-?[a-zA-Z][a-zA-Z0-9-]*(?:[-/.[][^\s]*)?$/;

/** Split on `:` at bracket depth zero — `supports-[display:grid]:grid` is two segments, not three. */
function splitTopLevel(token) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === ":" && depth === 0) {
      parts.push(token.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(token.slice(start));
  return parts;
}

function hasVariantShape(token) {
  const parts = splitTopLevel(token);
  if (parts.length < 2) return false;
  const base = parts.pop();
  if (!UTILITY_SHAPE.test(base)) return false;
  return parts.some(
    (segment) =>
      KNOWN_VARIANTS.has(segment) || PARAMETRIC_VARIANT.test(segment) || segment.startsWith("["),
  );
}

/**
 * Strip what a class can carry without changing which utility it is: variant prefixes and the
 * important marker (v4 writes it trailing, `bg-red-500!`; the v3 leading `!` still appears here).
 */
function normalize(token) {
  return baseUtility(token).replace(/^!+/, "").replace(/!+$/, "");
}

/**
 * Strip Tailwind variant prefixes: `data-[state=open]:animate-in` → `animate-in`.
 *
 * Splitting on the last `:` outside brackets, because a variant can itself contain one
 * (`data-[state=open]`, `supports-[display:grid]`).
 */
function baseUtility(token) {
  let depth = 0;
  for (let i = token.length - 1; i >= 0; i--) {
    const c = token[i];
    if (c === "]") depth++;
    else if (c === "[") depth--;
    else if (c === ":" && depth === 0) return token.slice(i + 1);
  }
  return token;
}

/**
 * Could this token be a CSS class at all?
 *
 * Two jobs. It keeps obvious non-classes out of the report — `e.message`, `File`, `})` are not
 * broken utilities — and it keeps them out of the oracle, which matters more than it sounds:
 * `@source inline(…)` parses its argument as a brace/glob pattern, so the unbalanced paren in
 * `(e.code` made Tailwind treat everything after it as one unterminated group. 5,053 tokens in,
 * the list stopped resolving and `bg-red-600` came back "undefined".
 */
const PLAUSIBLE = /^[-A-Za-z0-9_@!*+~<>=$&%#.,:/[\]()]+$/;

function isPlausibleClass(token) {
  if (!PLAUSIBLE.test(token)) return false;
  let round = 0;
  let square = 0;
  for (const c of token) {
    if (c === "(") round++;
    else if (c === ")") round--;
    else if (c === "[") square++;
    else if (c === "]") square--;
    if (round < 0 || square < 0) return false;
  }
  return round === 0 && square === 0;
}

/**
 * Plain `.class` rules declared in globals.css — defined, but not by Tailwind.
 *
 * Parsed, not grepped. A line-anchored regex missed every rule nested inside a media query
 * (`.mobile-stack`, `.mobile-full`, `.mobile-p-4` under `@media (max-width: 640px)`), which is
 * the half of the file most likely to go stale unnoticed.
 */
function handWrittenClasses(css) {
  const out = new Set();
  postcss.parse(css).walkRules((rule) => {
    // Selector lists and compound selectors both: `.panel, .glass {…}` defines two,
    // `.alert-card.alert-success {…}` defines a modifier that only ever appears alongside.
    for (const [, name] of rule.selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)) out.add(name);
  });
  return out;
}

/**
 * `@utility foo { … }` — Tailwind generates these, but list them so the unused scan sees them.
 *
 * Functional utilities (`@utility slide-in-from-left-*`) are excluded: they are never used under
 * that literal name, so counting them would report `slide-in-from-left-` as permanently dead.
 */
function utilityDeclarations(css) {
  const out = new Set();
  for (const [, name] of css.matchAll(/^@utility\s+([a-zA-Z0-9_-]+)(\*?)/gm)) {
    if (!name.endsWith("-")) out.add(name);
  }
  return out;
}

// ── the oracle ────────────────────────────────────────────────────────────────────────────────

/**
 * A token Tailwind will always build, appended to every batch to prove the batch was read whole.
 *
 * The truncation bug above was silent — a truncated list looks exactly like a list of invalid
 * classes, which is the same "did nothing, said nothing" shape this whole checker exists to catch.
 * So the oracle checks itself: if the canary does not come back, the batch was not fully
 * processed, and it is split rather than believed.
 */
const CANARY = "mt-[3.14159px]";

async function compile(tokens) {
  const globals = readFileSync(GLOBALS, "utf8");
  // Keep the real @theme/@utility content so tokens that depend on it resolve correctly, but
  // replace the project scan with our explicit candidate list.
  const probe =
    globals.replace(/@import\s+["']tailwindcss["'][^;]*;/, '@import "tailwindcss" source(none);') +
    `\n@source inline("${tokens.join(" ")} ${CANARY}");\n`;

  const result = await postcss([tailwind()]).process(probe, { from: GLOBALS });

  // Read the SELECTORS, not the stylesheet text.
  //
  // The first version asked whether the raw token appeared anywhere in the output CSS. That is
  // wrong in the direction that hurts: `Property`, `Lease`, `Missing` and four hundred other
  // English words "resolved" because those letters occur somewhere in a var name or a comment.
  // Every one of them then counted toward a literal's resolved ratio, which is what let whole
  // sentences pass as class lists and put prose in Direction A's report.
  //
  // Tailwind escapes what it generates — `sm:px-4` → `.sm\:px-4`, `bg-[var(--x)]` →
  // `.bg-\[var\(--x\)\]` — so the class name is recovered by unescaping, and the comparison
  // becomes exact.
  const generated = new Set();
  result.root.walkRules((rule) => {
    for (const [, name] of rule.selector.matchAll(/\.((?:[^\s.,:>+~()[\]{}'"\\]|\\.)+)/g)) {
      generated.add(name.replace(/\\(.)/g, "$1"));
    }
  });
  return generated;
}

async function resolveBatch(tokens, into) {
  if (tokens.length === 0) return;
  let generated;
  try {
    generated = await compile(tokens);
  } catch {
    generated = null; // an unbalanced brace throws outright rather than truncating
  }

  if (generated?.has(CANARY)) {
    for (const token of tokens) if (generated.has(token)) into.add(token);
    return;
  }

  // Something in here derailed the compile. One token cannot be split further — accept that it
  // does not resolve. Anything larger is halved so the rest of the batch is still measured.
  if (tokens.length === 1) return;
  const mid = Math.ceil(tokens.length / 2);
  await resolveBatch(tokens.slice(0, mid), into);
  await resolveBatch(tokens.slice(mid), into);
}

async function tailwindResolves(tokens) {
  const candidates = [...tokens].filter(isPlausibleClass);
  const resolved = new Set();
  const BATCH = 500;
  for (let i = 0; i < candidates.length; i += BATCH) {
    await resolveBatch(candidates.slice(i, i + BATCH), resolved);
  }
  return resolved;
}

// ── report ────────────────────────────────────────────────────────────────────────────────────

function report(title, items, baseline, note) {
  const count = items.length;
  const status = count > baseline ? "✗" : count === baseline ? "=" : "↓";
  console.log(`\n${status} ${title}: ${count} (baseline ${baseline})`);
  if (note) console.log(`  ${note}`);
  for (const item of items.slice(0, 60)) console.log(`    ${item}`);
  if (count > 60) console.log(`    …and ${count - 60} more`);
  return count;
}

async function main() {
  const strict = process.argv.includes("--strict");
  const files = SCAN_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));

  const literals = [];
  const shaped = new Set(); // tokens that wore a real variant prefix — classes on their own
  const seenAnywhere = new Set(); // every literal token — recall, for direction B
  for (const file of files) {
    for (const tokens of extractStringLiterals(readFileSync(file, "utf8"), shaped)) {
      literals.push(tokens);
      for (const token of tokens) seenAnywhere.add(token);
    }
  }

  const globals = readFileSync(GLOBALS, "utf8");
  const handWritten = handWrittenClasses(globals);
  const declaredUtilities = utilityDeclarations(globals);

  // One trip through the oracle for every distinct token in the tree. Doing it per literal would
  // compile Tailwind thousands of times; doing it after the class-list decision is impossible,
  // because the decision is made OF the resolution results.
  const resolved = await tailwindResolves(seenAnywhere);

  const isResolvable = (token) =>
    resolved.has(token) ||
    handWritten.has(token) ||
    declaredUtilities.has(token) ||
    UNDEFINED_ALLOWLIST.some((re) => re.test(token));

  // Direction A — used but not defined. Either signal is enough to call a token a class; a token
  // that could not be a class name under any spelling is punctuation that shared a string literal.
  const undefinedClasses = [
    ...new Set([
      ...classListsOnly(literals, isResolvable),
      ...[...shaped].filter((token) => !isResolvable(token)),
    ]),
  ]
    .filter(isPlausibleClass)
    .sort();

  // Direction B — defined but not used. `@utility` declarations count as definitions too.
  const defined = new Set([...handWritten, ...declaredUtilities]);
  const unusedClasses = [...defined]
    .filter((c) => !UNUSED_ALLOWLIST.has(c) && !seenAnywhere.has(c))
    .sort();

  const a = report(
    "Used but not defined",
    undefinedClasses,
    BASELINE.undefined,
    "These render as nothing. This is the shape the overlay animations broke in.",
  );
  const b = report(
    "Defined but not used",
    unusedClasses,
    BASELINE.unused,
    "Dead rules in app/globals.css. Delete them.",
  );

  console.log(
    `\n  Scanned ${files.length} files, ${literals.length} string literals, ` +
      `${seenAnywhere.size} distinct tokens.\n`,
  );

  if (strict && (a > BASELINE.undefined || b > BASELINE.unused)) {
    console.error("Class contract regressed. Fix the classes, or justify them in an allowlist.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("check-class-contract failed to run:", error);
  process.exit(2);
});
