import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeContactType } from "./contacts-view";

/**
 * The bug this pins was invisible to every gate the repo has.
 *
 * `/api/contacts` returns Prisma's `MaintenanceContactType` — `CONTRACTOR`, `VENDOR`,
 * `INTERNAL_STAFF` — while this view compares against `"contractor" | "vendor" | "internal"`. The
 * fetch bridged the two with `c.type as MaintenanceContact["type"]`, and a cast asserts a shape
 * rather than producing one, so `tsc` was told the answer instead of checking it. Lint had nothing
 * to complain about, and the mobile audit reported zero overflow and zero clipping on a screen
 * whose every type filter returned an empty list.
 *
 * What a reader actually saw: "4 contacts · 0 contractors · 0 vendors · 0 internal" above four
 * populated cards, each with an empty pill where its type badge should be.
 */
describe("normalizeContactType", () => {
  it("maps every value of the Prisma enum onto the view's union", () => {
    expect(normalizeContactType("CONTRACTOR")).toBe("contractor");
    expect(normalizeContactType("VENDOR")).toBe("vendor");
    expect(normalizeContactType("INTERNAL_STAFF")).toBe("internal");
  });

  /**
   * Read from `schema.prisma` rather than restated here. A fourth enum member would otherwise land
   * with nothing to notice it — the view would file it as a contractor and the counts would be
   * quietly wrong again, which is the exact failure being fixed.
   */
  it("covers the enum as the schema actually declares it", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf-8");
    const block = schema.match(/enum MaintenanceContactType \{([^}]*)\}/);
    expect(block, "MaintenanceContactType not found in schema.prisma").toBeTruthy();

    const members = block![1]
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, "").trim())
      .filter(Boolean);

    expect(members).toHaveLength(3);
    // Every declared member must resolve to something the filters and labels understand — the
    // `contractor` default must never be reached by a value the schema actually emits.
    for (const member of members) {
      expect(["contractor", "vendor", "internal"]).toContain(normalizeContactType(member));
    }
    expect(new Set(members.map(normalizeContactType)).size).toBe(3);
  });

  it("is case-insensitive and survives a missing value", () => {
    expect(normalizeContactType("vendor")).toBe("vendor");
    expect(normalizeContactType("internal")).toBe("internal");
    expect(normalizeContactType(null)).toBe("contractor");
    expect(normalizeContactType(undefined)).toBe("contractor");
  });
});
