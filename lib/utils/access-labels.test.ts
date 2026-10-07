import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";
import es from "@/messages/es.json";
import it_ from "@/messages/it.json";
import { accountRoleSchema, invitationSchema } from "@/lib/schemas/admin-access.schema";
import {
  ACCESS_ROLE_KEY,
  ASSIGNABLE_ROLES,
  REGISTRATION_COPY,
  assignableRole,
} from "./access-labels";

const CATALOGUES = { en, pt, es, it: it_ } as const;

/** The string a dotted key names in a catalogue, or undefined. */
function lookup(root: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], root);
}

describe("ACCESS_ROLE_KEY", () => {
  it.each(Object.entries(CATALOGUES))("labels every role in %s", (_language, messages) => {
    for (const key of Object.values(ACCESS_ROLE_KEY)) {
      expect(lookup(messages.admin.access, key), key).toEqual(expect.any(String));
    }
  });
});

describe("ASSIGNABLE_ROLES", () => {
  it("is exactly what the API takes for an account and for an invitation", () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(accountRoleSchema.safeParse({ role }).success, role).toBe(true);
      expect(invitationSchema.safeParse({ email: "a@example.test", role }).success, role).toBe(
        true,
      );
    }
    // Neither accepts the role no screen can give, so a screen that listed it would only ever fail.
    expect(accountRoleSchema.safeParse({ role: "USER" }).success).toBe(false);
    expect(invitationSchema.safeParse({ email: "a@example.test", role: "USER" }).success).toBe(
      false,
    );
  });

  it("lists the role that can do less first, so that is the one a form opens on", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["MANAGER", "ADMIN"]);
  });
});

describe("assignableRole", () => {
  it("names the role a select value means, and nothing for a value that is none", () => {
    expect(assignableRole("ADMIN")).toBe("ADMIN");
    expect(assignableRole("MANAGER")).toBe("MANAGER");
    expect(assignableRole("USER")).toBeUndefined();
    expect(assignableRole("")).toBeUndefined();
    expect(assignableRole("constructor")).toBeUndefined();
  });
});

describe("REGISTRATION_COPY", () => {
  it.each(Object.entries(CATALOGUES))(
    "has a title and a help sentence in %s for every state",
    (_language, messages) => {
      for (const [state, copy] of Object.entries(REGISTRATION_COPY)) {
        expect(lookup(messages.admin.signIn, copy.title), `${state} title`).toEqual(
          expect.any(String),
        );
        expect(lookup(messages.admin.signIn, copy.help), `${state} help`).toEqual(
          expect.any(String),
        );
      }
    },
  );

  it("tints as open exactly the states that let in a person nobody named", () => {
    const open = Object.entries(REGISTRATION_COPY)
      .filter(([, copy]) => copy.open)
      .map(([state]) => state)
      .sort();
    expect(open).toEqual(["google", "open_bootstrap"]);
  });
});
