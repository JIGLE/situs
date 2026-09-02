import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `BankTransaction.rawData` must never carry an identifier that the row beside it encrypts.
 *
 * The write in `lib/services/bank/import.ts` encrypted the IBAN into `counterpartyIban` and
 * then, three lines later, wrote `rawData: JSON.stringify(row)` — the same object, IBAN in
 * clear, into an ordinary unencrypted column. The encryption above was undone by the line
 * below it, and nothing disagreed: both lines are individually correct-looking, the types are
 * satisfied, and `rawData` is written by one call site and read by none, so no test or screen
 * would ever have shown the leak.
 *
 * That last part is why this is a static contract rather than a unit test on the persisted row.
 * A unit test proves `redactRowForStorage` drops the field; it cannot stop someone restoring
 * `JSON.stringify(row)` at the call site, which is the exact edit that caused this. The guard
 * has to sit over the source.
 *
 * Scope note: this checks the ASSIGNMENT, not the helper. `redactRowForStorage` has its own
 * tests in `lib/services/bank/csv.test.ts`, including that the IBAN survives nowhere in the
 * serialised string.
 */
const ROOT = join(import.meta.dirname, "..");

/** Files assigning `rawData:`, from git rather than a hand-kept list that would go stale. */
function writeSites(): string[] {
  const out = execSync(
    "grep -rl 'rawData:' lib app components --include=*.ts --include=*.tsx || true",
    { cwd: ROOT, encoding: "utf8" },
  ).trim();
  return out ? out.split("\n") : [];
}

describe("BankTransaction.rawData redaction contract", () => {
  it("finds the write site, so the guard cannot pass by scanning nothing", () => {
    // The repo's signature bug is the green-but-inert check. If the grep matches nothing, the
    // file moved or was renamed — that is a failure to investigate, not a pass.
    expect(writeSites().length).toBeGreaterThan(0);
  });

  it("never serialises an unredacted row into rawData", () => {
    const offenders: string[] = [];

    for (const file of writeSites()) {
      const source = readFileSync(join(ROOT, file), "utf8");
      source.split("\n").forEach((line, i) => {
        const assignment = line.match(/rawData:\s*(.+)$/);
        if (!assignment) return;

        const value = assignment[1];
        // `JSON.stringify(<something>)` where <something> is not a redaction call.
        const stringify = value.match(/JSON\.stringify\(\s*([A-Za-z_$][\w$]*)\s*[),]/);
        if (stringify) {
          offenders.push(
            `${file}:${i + 1} serialises \`${stringify[1]}\` directly — ` +
              `wrap it in redactRowForStorage() so the IBAN is not stored in clear`,
          );
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it("routes the bank import's rawData through the redaction helper", () => {
    // Positive assertion as well as the negative one above: the negative alone would pass if
    // the assignment were deleted entirely, which is a different change needing a different look.
    const importer = readFileSync(join(ROOT, "lib/services/bank/import.ts"), "utf8");
    expect(importer).toMatch(/rawData:\s*JSON\.stringify\(redactRowForStorage\(/);
  });
});
