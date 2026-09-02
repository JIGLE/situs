import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { buildExportInclude, excludedRelations, EXPORT_DENY_LIST } from "./export-scope";

/**
 * The point of these is that the export cannot quietly narrow again.
 *
 * The version this replaced listed eleven relations against a User model with thirty-five, and
 * nothing disagreed — a hand-written `include` is a claim about the schema that the schema
 * never gets to check. So the assertions below compare the export against Prisma's own model
 * metadata rather than against a second hand-written list, which would drift the same way.
 */
function schemaRelations(): string[] {
  const user = Prisma.dmmf.datamodel.models.find((m) => m.name === "User");
  if (!user) throw new Error("no User model in dmmf");
  return user.fields.filter((f) => f.kind === "object").map((f) => f.name);
}

describe("GDPR export scope", () => {
  it("reads a non-trivial set of relations, so a passing test means something", () => {
    // Guards against the whole suite going green because the metadata returned nothing.
    expect(schemaRelations().length).toBeGreaterThan(20);
  });

  it("exports every relation on User except the deny-listed ones", () => {
    const exported = Object.keys(buildExportInclude()).sort();
    const expected = schemaRelations()
      .filter((r) => !(r in EXPORT_DENY_LIST))
      .sort();

    // If this fails after adding a model, the fix is usually nothing: the export picks it up
    // automatically. It failing means something is filtering that should not be.
    expect(exported).toEqual(expected);
  });

  it("includes the bank relations — the omission that motivated this", () => {
    const include = buildExportInclude();
    for (const relation of [
      "bankConnections",
      "bankAccounts",
      "bankTransactions",
      "bankSyncJobs",
    ]) {
      expect(include, `${relation} missing from the GDPR export`).toHaveProperty(relation, true);
    }
  });

  it("includes the ledger and fiscal relations the old list also missed", () => {
    const include = buildExportInclude();
    for (const relation of [
      "rentPeriods",
      "paymentAllocations",
      "invoices",
      "taxFilings",
      "governmentVerifications",
      "documentExtractions",
    ]) {
      expect(include, `${relation} missing from the GDPR export`).toHaveProperty(relation, true);
    }
  });

  it("never exports NextAuth credential tables", () => {
    const include = buildExportInclude();
    // These hold access/refresh/id tokens and live session tokens. A downloadable file
    // containing them is a credential leak, not a subject access request.
    expect(include).not.toHaveProperty("accounts");
    expect(include).not.toHaveProperty("sessions");
  });

  it("gives a reason for every exclusion", () => {
    // An entry with no reason is how a deny-list turns into a place to hide things.
    for (const [relation, reason] of Object.entries(EXPORT_DENY_LIST)) {
      expect(reason, `${relation} is excluded without a stated reason`).toBeTruthy();
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("only denies relations that actually exist, so the list cannot go stale", () => {
    const relations = schemaRelations();
    for (const relation of Object.keys(EXPORT_DENY_LIST)) {
      expect(
        relations,
        `${relation} is deny-listed but is not a relation on User — remove it`,
      ).toContain(relation);
    }
  });

  it("reports what it excluded, so the export can say so", () => {
    expect(excludedRelations().sort()).toEqual(Object.keys(EXPORT_DENY_LIST).sort());
  });
});
