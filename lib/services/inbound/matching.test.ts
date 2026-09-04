import { describe, it, expect } from "vitest";

import { isSenderAuthenticated, matchSender, type MatchCandidate } from "./matching";

const tenants: MatchCandidate[] = [
  { id: "t1", email: "maria@example.com", propertyId: "p1" },
  { id: "t2", email: "joao@example.com", propertyId: "p2" },
  { id: "t3", email: "shared@example.com", propertyId: "p3" },
  { id: "t4", email: "shared@example.com", propertyId: "p4" },
];

describe("matchSender", () => {
  it("matches an exact address and carries the property through", () => {
    expect(matchSender("maria@example.com", tenants)).toEqual({
      tenantId: "t1",
      propertyId: "p1",
      reason: "exact-email",
    });
  });

  it("ignores case and surrounding whitespace on both sides", () => {
    expect(matchSender("  MARIA@Example.com ", tenants)?.tenantId).toBe("t1");
  });

  it("returns nothing when two tenants share the address", () => {
    // A couple on one lease, or a data-entry mistake. Picking one would put one person's
    // correspondence in front of the other.
    expect(matchSender("shared@example.com", tenants)).toBeNull();
  });

  /**
   * The rules this matcher deliberately does NOT have. Each of these would produce a suggestion,
   * and a suggestion is the thing a landlord clicks "confirm" on.
   */
  it("does not match on domain alone", () => {
    expect(matchSender("someone-else@example.com", tenants)).toBeNull();
  });

  it("does not match a substring or a plus-addressed variant", () => {
    expect(matchSender("maria@example.com.evil.test", tenants)).toBeNull();
    expect(matchSender("maria+spoof@example.com", tenants)).toBeNull();
  });

  it("returns nothing for an empty sender or an empty candidate list", () => {
    expect(matchSender("", tenants)).toBeNull();
    expect(matchSender("   ", tenants)).toBeNull();
    expect(matchSender("maria@example.com", [])).toBeNull();
  });
});

describe("isSenderAuthenticated", () => {
  it("is true when either check passed", () => {
    expect(isSenderAuthenticated("pass", "fail")).toBe(true);
    expect(isSenderAuthenticated("fail", "pass")).toBe(true);
    expect(isSenderAuthenticated("PASS", undefined)).toBe(true);
  });

  it("is false when neither passed, including when neither ran", () => {
    expect(isSenderAuthenticated("fail", "fail")).toBe(false);
    expect(isSenderAuthenticated("softfail", "none")).toBe(false);
    expect(isSenderAuthenticated(undefined, undefined)).toBe(false);
    expect(isSenderAuthenticated(null, null)).toBe(false);
  });
});
