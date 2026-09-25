import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A receipt says rent arrived, so only money that exists may write one.
 *
 * "Gerar recibos do mês" (`POST /api/receipts/bulk`) wrote a `paid` receipt at the full rent for
 * every active lease without one that month, and allocated it to the rent ledger. One click, with
 * no confirmation, and a tenant who had paid nothing read as paid: on the ledger, in the rent
 * matrix and in every total. The button and the route are gone. Three places create a receipt now,
 * each behind a payment:
 *
 * - `lib/services/database/receipt/service.ts`: the owner records a payment they received
 *   ("Registar pagamento"), through `POST /api/receipts`, the one caller of its `create`;
 * - `lib/services/bank/import.ts`: a bank movement matched to a lease, as a draft for review;
 * - `lib/demo-seed.ts`: the demo instance's sample data.
 *
 * The guard sits over the source, as `bank-rawdata-redaction-contract.test.ts` does: the change to
 * catch is a new write site, and no unit test of an existing one can see it. It reads files rather
 * than lines, so a call split across lines is still found.
 *
 * Scope: calls that create a `Receipt` row, through the Prisma delegate or the receipt service.
 * Updates are outside it: a route that turns an existing receipt `paid` would not be seen here.
 */
const ROOT = join(import.meta.dirname, "..");
const SCANNED = ["app", "lib", "components", "scripts", "prisma"];

/** `prisma.receipt.create(`, `tx.receipt.upsert(`, and the same split across lines. */
const DELEGATE_WRITE = /\.receipt\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(/g;
const SERVICE_CREATE = /\breceiptService\s*\.\s*create\s*\(/g;

const DELEGATE_WRITERS = [
  "lib/demo-seed.ts",
  "lib/services/bank/import.ts",
  "lib/services/database/receipt/service.ts",
];
const SERVICE_CALLERS = ["app/api/receipts/route.ts"];

type Site = { file: string; line: number };

function sourceFiles(): string[] {
  return SCANNED.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .map((path) => `${dir}/${path.split("\\").join("/")}`)
      .filter((path) => /\.[cm]?[jt]sx?$/.test(path) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)),
  );
}

function sites(pattern: RegExp): Site[] {
  return sourceFiles().flatMap((file) => {
    const source = readFileSync(join(ROOT, file), "utf8");
    return [...source.matchAll(pattern)].map((match) => ({
      file,
      line: source.slice(0, match.index).split("\n").length,
    }));
  });
}

const where = (list: Site[]) => list.map(({ file, line }) => `${file}:${line}`);

describe("only a payment creates a receipt", () => {
  const writes = sites(DELEGATE_WRITE);
  const calls = sites(SERVICE_CREATE);

  it("finds every write site it allows, so it cannot pass by scanning nothing", () => {
    expect([...new Set(writes.map((s) => s.file))].sort()).toEqual(
      expect.arrayContaining(DELEGATE_WRITERS),
    );
    expect(calls.map((s) => s.file)).toEqual(expect.arrayContaining(SERVICE_CALLERS));
  });

  it("creates Receipt rows nowhere else", () => {
    expect(
      where(writes.filter((s) => !DELEGATE_WRITERS.includes(s.file))),
      "a new place writes receipts: only a recorded payment or a matched bank movement may",
    ).toEqual([]);
  });

  it("calls the receipt service's create from POST /api/receipts only", () => {
    expect(
      where(calls.filter((s) => !SERVICE_CALLERS.includes(s.file))),
      "a new caller creates receipts through the service: only a recorded payment may",
    ).toEqual([]);
  });
});
