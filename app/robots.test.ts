import { describe, it, expect } from "vitest";

import robots from "./robots";

describe("robots.txt", () => {
  const rules = (() => {
    const r = robots().rules;
    return Array.isArray(r) ? r : [r];
  })();

  it("closes the whole instance to every crawler", () => {
    expect(rules).toHaveLength(1);
    expect(rules[0].userAgent).toBe("*");
    expect(rules[0].disallow).toBe("/");
  });

  it("keeps the two legal pages open: a PSD2 registration reviewer fetches them", () => {
    expect(rules[0].allow).toEqual(["/privacy", "/terms"]);
  });

  it("publishes no sitemap: nothing here is meant to be indexed", () => {
    expect(robots().sitemap).toBeUndefined();
  });
});
