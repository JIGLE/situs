import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import Stripe from "stripe";

/**
 * The Stripe API version is the SDK's, never a date typed out by hand.
 *
 * `stripe-node` declares the constructor option as `apiVersion?: LatestApiVersion`, and
 * `LatestApiVersion = typeof ApiVersion` — a union of exactly ONE member: the dated version
 * that release of the SDK pins. So a hardcoded date is not a loose pin that drifts, it is a
 * value that stops type-checking the instant the SDK moves.
 *
 * That is not hypothetical. Two files carried `apiVersion: "2026-07-29.dahlia"`, and the
 * production-minor Dependabot PR — which bumped `stripe` 22.5.0 → 22.6.0, whose changelog reads
 * "This release changes the pinned API version to 2026-08-26.dahlia" — failed `tsc --noEmit`
 * on both of them and on nothing else. The whole PR was red for a string.
 *
 * The literal was never load-bearing. `stripe.core.js` resolves the option as
 * `props.apiVersion || DEFAULT_API_VERSION` with `DEFAULT_API_VERSION = ApiVersion`, so passing
 * the SDK's own pin and passing nothing are byte-identical requests. Writing it out bought no
 * stability and cost a compile error per release.
 *
 * A static contract rather than a unit test, for the reason the envelope contract is one: the
 * next person to add a Stripe client will copy an existing construction, and if a date literal
 * is what they copy, the failure arrives on some future Dependabot PR rather than in review.
 */
const ROOT = join(import.meta.dirname, "..");

/** Source files constructing a Stripe client, from git rather than a hand-kept list. */
function stripeClientFiles(): string[] {
  const out = execSync(
    "grep -rl 'new Stripe(' app lib components --include=*.ts --include=*.tsx || true",
    { cwd: ROOT, encoding: "utf8" },
  ).trim();
  return out ? out.split("\n") : [];
}

/** A dated Stripe API version: `2026-08-26.dahlia`, `2020-03-02`, and anything shaped like them. */
const DATE_LITERAL = /apiVersion:\s*["'`](\d{4}-\d{2}-\d{2}[^"'`]*)["'`]/g;

describe("Stripe API version", () => {
  it("finds the files that construct a client", () => {
    // Guards the guard. If `new Stripe(` is ever renamed or the paths move, `grep -rl` returns
    // nothing, every assertion below iterates an empty list, and this file reports clean while
    // checking exactly nothing — the "absence reads as green" shape this repo keeps rebuilding.
    expect(stripeClientFiles().length).toBeGreaterThan(0);
  });

  it("is never written as a date literal", () => {
    const offenders: string[] = [];

    for (const file of stripeClientFiles()) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const match of source.matchAll(DATE_LITERAL)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file}:${line} — apiVersion: "${match[1]}"`);
      }
    }

    expect(
      offenders,
      `Hardcoded Stripe API version(s). This breaks \`tsc\` on the next SDK bump, because\n` +
        `stripe-node types the field as a one-member union of its own pin. Use\n` +
        `\`Stripe.API_VERSION\`, which is that same value and moves with the SDK:\n\n` +
        offenders.map((o) => `  ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("is passed explicitly by every client that sets it", () => {
    // Omitting `apiVersion` entirely would behave identically, but silence reads as an
    // oversight where `Stripe.API_VERSION` reads as a decision. Whichever a file chooses, what
    // it must not do is name a version the SDK does not.
    for (const file of stripeClientFiles()) {
      const source = readFileSync(join(ROOT, file), "utf8");
      if (!source.includes("apiVersion")) continue;
      expect(
        source,
        `${file} sets apiVersion to something other than Stripe.API_VERSION`,
      ).toContain("apiVersion: Stripe.API_VERSION");
    }
  });

  it("is a dated version string at runtime", () => {
    // The swap has to make the SAME request the literal made, not merely a compiling one.
    // `Stripe.API_VERSION` is what the SDK falls back to internally, so this pins that the
    // value the app now sends is a real dated version rather than undefined.
    expect(Stripe.API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\./);
  });
});
