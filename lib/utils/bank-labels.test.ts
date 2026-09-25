// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IMPORT_WARNING_CODES, bankStatusKey, matchSignals } from "./bank-labels";

const stored = (reasons: string[], warnings: string[] = []) =>
  JSON.stringify({ reasons, warnings, rule: null });

describe("matchSignals", () => {
  it("names the engine's reasons, then the import's warnings", () => {
    expect(matchSignals(stored(["iban_match", "amount_exact"], ["possible_duplicate"]))).toEqual([
      { key: "signals.ibanMatch" },
      { key: "signals.amountExact" },
      { key: "signals.possibleDuplicate" },
    ]);
  });

  it("keeps a rule's own name", () => {
    expect(matchSignals(stored(["rule:Renda Maria"]))).toEqual([
      { key: "signals.rule", values: { name: "Renda Maria" } },
    ]);
  });

  it("reads both months out of a reference conflict", () => {
    expect(matchSignals(stored([], ["reference_conflict:2026-07≠2026-06"]))).toEqual([
      { key: "signals.referenceConflict", values: { reference: "2026-07", expected: "2026-06" } },
    ]);
  });

  it("leaves out a code it does not know, rather than showing it raw", () => {
    expect(matchSignals(stored(["something_new"], ["negative_amount"]))).toEqual([
      { key: "signals.negativeAmount" },
    ]);
  });

  it("returns nothing for no signals or a damaged value", () => {
    expect(matchSignals(null)).toEqual([]);
    expect(matchSignals("not json")).toEqual([]);
    expect(matchSignals(JSON.stringify({ reasons: "iban_match" }))).toEqual([]);
  });

  it("has a label for every warning the import writes", () => {
    // Held to the source: a warning added to importBankRows without a label here would reach
    // the owner as nothing at all.
    const source = readFileSync(join(__dirname, "../services/bank/import.ts"), "utf8");
    const written = [...source.matchAll(/warnings\.push\("([a-z_]+)"\)/g)].map((m) => m[1]);

    expect(written.length).toBeGreaterThan(0);
    expect([...new Set(written)].sort()).toEqual([...IMPORT_WARNING_CODES].sort());
    for (const code of IMPORT_WARNING_CODES) {
      expect(matchSignals(stored([], [code]))).toHaveLength(1);
    }
  });
});

describe("bankStatusKey", () => {
  it("labels every status the inbox can hold", () => {
    for (const status of [
      "needs_review",
      "auto_matched",
      "matched_confirmed",
      "ignored",
      "imported",
      "duplicate",
    ]) {
      expect(bankStatusKey(status)).toMatch(/^status\./);
    }
  });

  it("returns null for a status nothing writes, and for inherited names", () => {
    expect(bankStatusKey("archived")).toBeNull();
    expect(bankStatusKey("constructor")).toBeNull();
  });
});
