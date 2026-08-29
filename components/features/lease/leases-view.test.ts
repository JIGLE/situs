import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The tax-regime filter offered two values a lease can never hold.
 *
 * `filters` listed `article9` and `article53` — an IVA-exemption pair from an earlier shape of
 * the field — while `Lease.taxRegime` only ever holds what the wizard's own regime Select
 * writes: `portugal_rendimentos` or `spain_inmuebles`. The comparison at the filter site is a
 * plain `===`, so both options matched nothing, on every account, always. Nothing caught it:
 * `taxRegime` is a Prisma `String`, not an enum, so there is no type to disagree with, and an
 * empty result set is indistinguishable from a filter that legitimately excluded everything.
 *
 * These read the values out of the source rather than restating them, because restating them is
 * how the two drifted apart in the first place. A regime added to the form without being added
 * to the filter fails here; so does the reverse.
 */
const ROOT = join(import.meta.dirname, "../../..");
const source = readFileSync(join(ROOT, "components/features/lease/leases-view.tsx"), "utf8");

/** The `options: [...]` array belonging to the `key: "taxRegime"` filter. */
function filterOptionValues(): string[] {
  // Anchored so the gap cannot span another `key:` — an unanchored match starts at the
  // `"taxRegime"` in the search-field list far above and runs on into the STATUS filter's
  // options, which then look like the regime ones and pass a test that proves nothing.
  const block = source.match(/key: "taxRegime",(?:(?!key: ")[\s\S])*?options: \[([\s\S]*?)\],/);
  expect(block, "taxRegime filter block not found — did the filter move?").toBeTruthy();
  return [...block![1].matchAll(/value: "([^"]+)"/g)].map((m) => m[1]);
}

/** The values the create/edit wizard can actually write to `taxRegime`. */
function writableRegimes(): string[] {
  const select = source.match(/htmlFor="taxRegime"[\s\S]*?<\/Select>/);
  expect(select, "taxRegime Select not found — did the wizard step move?").toBeTruthy();
  return [...select![0].matchAll(/<SelectItem value="([^"]+)"/g)].map((m) => m[1]);
}

describe("LeasesView tax-regime filter", () => {
  it("only offers regimes the form can write", () => {
    const writable = writableRegimes();
    expect(writable.length).toBeGreaterThan(0);

    const offered = filterOptionValues().filter((v) => v !== "all");
    expect(offered.length).toBeGreaterThan(0);
    for (const value of offered) {
      expect(writable, `filter offers "${value}", which no lease can hold`).toContain(value);
    }
  });

  it("offers every regime the form can write", () => {
    const offered = filterOptionValues();
    for (const value of writableRegimes()) {
      expect(offered, `leases can hold "${value}" but the filter cannot select it`).toContain(
        value,
      );
    }
  });

  it("matches the regimes demo data actually stores", () => {
    // A filter can agree with its own form and still miss every real record. The seed is the
    // only place in the tree that writes this field outside the form, so it is the check that
    // the offered values describe data that exists.
    const seed = readFileSync(join(ROOT, "lib/demo-seed.ts"), "utf8");
    const line = seed.match(/taxRegime: .*/);
    expect(line, "demo seed no longer sets taxRegime").toBeTruthy();

    const seeded = [...line![0].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(seeded.length).toBeGreaterThan(0);

    const offered = filterOptionValues();
    for (const value of seeded) {
      expect(offered, `demo data stores "${value}" but the filter cannot select it`).toContain(
        value,
      );
    }
  });
});
