import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EmailInUseError, refuseDuplicateEmail } from "./unique-email";

/**
 * `refuseDuplicateEmail` takes every Prisma P2002 on a tenant's or an owner's write for the email
 * one, which is true only while the account's email is the one unique index such a write can
 * break. A second one, on a NIF say, would have its violation answered as "that email is in use".
 * So the schema is read here, and a new unique index on either model fails this until the helper
 * learns which index broke (the error's `meta.target` says).
 */
describe("the one unique index a tenant's or an owner's write can break", () => {
  const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

  const uniqueConstraints = (model: string) => {
    const start = schema.indexOf(`\nmodel ${model} {`);
    expect(start, `model ${model} is not in the schema`).toBeGreaterThan(-1);
    return schema
      .slice(start, schema.indexOf("\n}\n", start))
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, "").trim())
      .filter((line) => line.includes("@unique") || line.includes("@@unique"));
  };

  it.each(["Tenant", "Owner"])("is the account's email, and no other, on %s", (model) => {
    expect(uniqueConstraints(model)).toEqual(["@@unique([userId, email])"]);
  });
});

describe("refuseDuplicateEmail", () => {
  it("gives back what the write gave", async () => {
    await expect(refuseDuplicateEmail("tenant", async () => "written")).resolves.toBe("written");
  });

  it("turns Prisma's P2002 into a 409 with its own reason, for a tenant and for an owner", async () => {
    const duplicate = async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    };

    for (const entity of ["tenant", "owner"] as const) {
      const error = await refuseDuplicateEmail(entity, duplicate).catch((e) => e);

      expect(error).toBeInstanceOf(EmailInUseError);
      expect(error).toMatchObject({ name: "EmailInUseError", reason: "email_in_use" });
      expect(error.message).toContain(entity);
    }
  });

  it("does not take any other failure for one, nor a thrown value that is not an error", async () => {
    const outage = new Error("database is locked");

    await expect(
      refuseDuplicateEmail("tenant", async () => {
        throw outage;
      }),
    ).rejects.toBe(outage);
    await expect(
      refuseDuplicateEmail("owner", async () => {
        throw null;
      }),
    ).rejects.toBeNull();
  });
});
