import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";
import es from "@/messages/es.json";
import it_ from "@/messages/it.json";
import { leaseSchema } from "@/lib/schemas/lease.schema";
import { TAX_REGIME_KEY, taxRegimeKey } from "./lease-labels";

describe("tax regime labels", () => {
  it("label every regime the lease schema accepts", () => {
    const regimes = leaseSchema.shape.taxRegime.unwrap().unwrap().options;
    expect(Object.keys(TAX_REGIME_KEY).sort()).toEqual([...regimes].sort());
  });

  it.each([
    ["en", en],
    ["pt", pt],
    ["es", es],
    ["it", it_],
  ])("have a %s translation for every key", (_locale, messages) => {
    for (const key of Object.values(TAX_REGIME_KEY)) {
      expect(messages.leases[key]).toEqual(expect.any(String));
    }
  });

  it("return nothing for a value no regime matches, however it is spelled", () => {
    expect(taxRegimeKey("article9")).toBeUndefined();
    expect(taxRegimeKey("toString")).toBeUndefined();
    expect(taxRegimeKey(null)).toBeUndefined();
  });
});
