import { describe, expect, it } from "vitest";
import { createTenantSchema, tenantSchema } from "./tenant.schema";

/**
 * A tenant read from Finanças has a name and a NIF, and no email or phone. Both are optional: a
 * tenant is not refused for lacking what nobody has typed, and what is typed is still checked.
 */
describe.each([
  ["tenantSchema", tenantSchema],
  ["createTenantSchema", createTenantSchema],
])("%s, the email and the phone", (_name, schema) => {
  const tenant = { name: "Ana Costa" };

  it("takes a tenant with only a name", () => {
    expect(schema.safeParse(tenant).success).toBe(true);
  });

  it.each([null, "", "   "])("takes an email of %j for none", (email) => {
    expect(schema.safeParse({ ...tenant, email }).success).toBe(true);
  });

  it.each([null, "", undefined])("takes a phone of %j for none", (phone) => {
    expect(schema.safeParse({ ...tenant, phone }).success).toBe(true);
  });

  it("still refuses an email that is not an address, with its own message", () => {
    const result = schema.safeParse({ ...tenant, email: "not-an-email" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Invalid email format");
  });

  it("still refuses a phone that is too long", () => {
    expect(schema.safeParse({ ...tenant, phone: "9".repeat(21) }).success).toBe(false);
  });

  it("still requires a name", () => {
    expect(schema.safeParse({ email: "ana@example.com" }).success).toBe(false);
  });
});
