import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { leaseSchema } from "@/lib/schemas/lease.schema";
import { TAX_REGIME_KEY } from "@/lib/utils/lease-labels";

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
 * The filter and the wizard's Select now both list `TAX_REGIME_KEY` (`lib/utils/lease-labels.ts`),
 * which is typed by the lease schema's enum, so neither can offer a regime the other lacks or the
 * schema rejects. What is left to check is that both really are built from it, and that it covers
 * the regimes stored data actually holds.
 */
const ROOT = join(import.meta.dirname, "../../..");
const source = readFileSync(join(ROOT, "components/features/lease/leases-view.tsx"), "utf8");

/** The `options: [...]` array belonging to the `key: "taxRegime"` filter. */
function filterOptions(): string {
  // Anchored so the gap cannot span another `key:` — an unanchored match starts at the
  // `"taxRegime"` in the search-field list far above and runs on into the STATUS filter's
  // options, which then look like the regime ones and pass a test that proves nothing.
  const block = source.match(/key: "taxRegime",(?:(?!key: ")[\s\S])*?options: \[([\s\S]*?)\],/);
  expect(block, "taxRegime filter block not found — did the filter move?").toBeTruthy();
  return block![1];
}

/** The create/edit wizard's regime Select. */
function wizardSelect(): string {
  const select = source.match(/htmlFor="taxRegime"[\s\S]*?<\/Select>/);
  expect(select, "taxRegime Select not found — did the wizard step move?").toBeTruthy();
  return select![0];
}

describe("LeasesView tax-regime filter", () => {
  it("builds the filter and the wizard's Select from the one regime map", () => {
    expect(filterOptions()).toContain("Object.entries(TAX_REGIME_KEY)");
    expect(wizardSelect()).toContain("Object.entries(TAX_REGIME_KEY)");
    // No regime spelled out by hand next to it, in either place.
    expect(filterOptions()).not.toMatch(/value: "(?!all")[^"]+"/);
    expect(wizardSelect()).not.toMatch(/<SelectItem value="/);
  });

  // The same drift one layer down: the filter, the Select and the seed agreed with each other, and
  // the schema that validates the form did not, so the Portuguese option could never be saved.
  it("only offers regimes the lease schema accepts", () => {
    for (const value of Object.keys(TAX_REGIME_KEY)) {
      expect(
        leaseSchema.shape.taxRegime.safeParse(value).success,
        `the form offers "${value}", which the lease schema rejects`,
      ).toBe(true);
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

    for (const value of seeded) {
      expect(
        Object.keys(TAX_REGIME_KEY),
        `demo data stores "${value}" but the filter cannot select it`,
      ).toContain(value);
    }
  });
});
