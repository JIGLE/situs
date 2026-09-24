import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

import { encryptPII, PII_FIELDS } from "@/lib/utils/pii-encryption";
import {
  buildExportInclude,
  decryptExportedRelations,
  excludedRelations,
  EXPORT_DENY_LIST,
} from "./export-scope";

/**
 * The point of these is that the export cannot quietly narrow again.
 *
 * The version this replaced listed eleven relations against a User model with thirty-five, and
 * nothing disagreed — a hand-written `include` is a claim about the schema that the schema
 * never gets to check. So the assertions below compare the export against Prisma's own model
 * metadata rather than against a second hand-written list, which would drift the same way.
 */
function schemaRelations(): string[] {
  return [...schemaRelationModels().keys()];
}

/** Each relation on `User` and the model it holds, straight from the metadata. */
function schemaRelationModels(): Map<string, string> {
  const user = Prisma.dmmf.datamodel.models.find((m) => m.name === "User");
  if (!user) throw new Error("no User model in dmmf");
  return new Map(user.fields.filter((f) => f.kind === "object").map((f) => [f.name, f.type]));
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

  it("includes the ledger relations the old list also missed", () => {
    const include = buildExportInclude();
    for (const relation of ["rentPeriods", "paymentAllocations"]) {
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

/**
 * The export reads every relation nested under the user, and the PII extension decrypts only the
 * top-level model a query names. So the file carried every NIF and phone number as `enc:…`.
 */
describe("decryptExportedRelations", () => {
  beforeEach(() => vi.stubEnv("PII_ENCRYPTION_KEY", "c".repeat(64)));
  afterEach(() => vi.unstubAllEnvs());

  it("decrypts every encrypted field under every relation that holds a PII model", () => {
    // Built from the metadata and PII_FIELDS, so a model added to either is covered here too.
    const user: Record<string, unknown> = { id: "user-1", email: "owner@example.pt" };
    const expected: Record<string, unknown> = { ...user };
    for (const [relation, model] of schemaRelationModels()) {
      const fields = PII_FIELDS[model];
      if (!fields) continue;
      const plain = Object.fromEntries(
        fields.map((field) => [field, `${model}.${field} 912345678`]),
      );
      const stored = Object.fromEntries(fields.map((field) => [field, encryptPII(plain[field])]));
      user[relation] = [{ id: `${model}-1`, ...stored }];
      expected[relation] = [{ id: `${model}-1`, ...plain }];
    }

    expect(JSON.stringify(user)).toContain("enc:");
    expect(decryptExportedRelations(user)).toEqual(expected);
  });

  it("reaches every model in PII_FIELDS through a relation on User", () => {
    // A PII model the user does not hold directly would sit in no relation, and so in no export.
    const models = new Set(schemaRelationModels().values());
    for (const model of Object.keys(PII_FIELDS)) {
      expect(models, `${model} is in PII_FIELDS but no relation on User holds it`).toContain(model);
    }
  });

  it("leaves the user's own fields, and relations with nothing encrypted, as they are", () => {
    const user = {
      id: "user-1",
      email: "owner@example.pt",
      properties: [{ id: "property-1", name: "Rua Augusta 12" }],
      settings: null,
    };

    expect(decryptExportedRelations(user)).toEqual(user);
  });
});
