import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { PII_FIELDS } from "@/lib/utils/pii-encryption";

/**
 * scripts/backfill-pii-encryption.js re-encrypts rows written before the Prisma extension existed.
 * It is plain CommonJS with no path aliases, so it carries its own copy of PII_FIELDS — and that
 * copy drifted: it kept `paymentMethod` after the model was deleted, so the script threw on its
 * first iteration and encrypted nothing. Reading the table as text keeps the script un-run here.
 */
function scriptTable(): Record<string, string[]> {
  const src = readFileSync(path.join(process.cwd(), "scripts/backfill-pii-encryption.js"), "utf8");
  const block = src.match(/const PII_FIELDS = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error("PII_FIELDS table not found in scripts/backfill-pii-encryption.js");
  return Object.fromEntries(
    [...block[1].matchAll(/^\s*(\w+): \[([^\]]*)\]/gm)].map(([, model, fields]) => [
      model,
      [...fields.matchAll(/"(\w+)"/g)].map((m) => m[1]),
    ]),
  );
}

describe("PII backfill contract", () => {
  it("encrypts exactly the fields the Prisma extension encrypts", () => {
    // A Prisma delegate is the model name with its first letter lowercased: `RentReceipt` is
    // `prisma.rentReceipt`.
    const expected = Object.fromEntries(
      Object.entries(PII_FIELDS).map(([model, fields]) => [
        model[0].toLowerCase() + model.slice(1),
        fields,
      ]),
    );
    const actual = scriptTable();
    expect(Object.keys(actual).length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });
});
