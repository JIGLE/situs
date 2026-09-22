import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseSchemaModels } from "./schema-drift";

/**
 * The parser is the load-bearing half of the drift check, and its failure mode is silent: a
 * parser that matches nothing reports zero missing columns, which is indistinguishable from a
 * database in perfect sync. `checkSchemaDrift` guards that case explicitly by treating "no
 * models parsed" as an error rather than success — these pin the parsing itself.
 */

const SAMPLE = `
model Tenant {
  id                    String    @id @default(cuid())
  userId                String
  portalAccessRevokedAt DateTime?
  legacyName            String    @map("legacy_name")

  // Relations — these occupy no column of their own
  user       User        @relation(fields: [userId], references: [id])
  receipts   Receipt[]

  @@index([userId])
  @@map("tenants")
}

model Unmapped {
  id   String @id
  size Int
}
`;

describe("parseSchemaModels", () => {
  const models = parseSchemaModels(SAMPLE);

  it("uses the @@map name as the table", () => {
    expect(models.find((m) => m.table === "tenants")).toBeTruthy();
  });

  it("falls back to the model name when there is no @@map", () => {
    expect(models.find((m) => m.table === "Unmapped")).toBeTruthy();
  });

  it("collects scalar columns, including the one that caused the outage", () => {
    const tenant = models.find((m) => m.table === "tenants")!;
    expect(tenant.columns).toContain("id");
    expect(tenant.columns).toContain("portalAccessRevokedAt");
  });

  it("uses @map to get the database column name, not the field name", () => {
    const tenant = models.find((m) => m.table === "tenants")!;
    expect(tenant.columns).toContain("legacy_name");
    expect(tenant.columns).not.toContain("legacyName");
  });

  it("excludes relation fields, which have no column", () => {
    const tenant = models.find((m) => m.table === "tenants")!;
    // `user` and `receipts` are relations. Counting them would make every table report missing
    // columns forever, and the check would be ignored within a day.
    expect(tenant.columns).not.toContain("user");
    expect(tenant.columns).not.toContain("receipts");
  });

  it("excludes block attributes", () => {
    const tenant = models.find((m) => m.table === "tenants")!;
    expect(tenant.columns.some((c) => c.startsWith("@"))).toBe(false);
  });

  it("parses the real schema, not just the fixture", () => {
    // The fixture proves the rules; this proves they still apply to the file that matters.
    // Without it, a schema-format change would leave every fixture case green while the live
    // check quietly parsed nothing.
    const real = parseSchemaModels(
      readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8"),
    );
    expect(real.length).toBeGreaterThan(20);

    const tenants = real.find((m) => m.table === "tenants");
    expect(tenants, "Tenant model not found in the real schema").toBeTruthy();
    // Was `portalAccessRevokedAt` until the tenant portal was cut. `email` replaces it because
    // the app cannot lose it, so the assertion outlives the next round of subtraction.
    // NOT `paymentStatus`, tempting as the ledger's own column is: `SCALAR_TYPES` excludes
    // enums by design, so the parser never reports it and the assertion would fail.
    expect(tenants!.columns).toContain("email");
  });
});
