import { describe, expect, it } from "vitest";
import { UnitStatus } from "@prisma/client";
import { UNIT_STATUSES, updateUnitSchema } from "./unit.schema";

describe("unit schema", () => {
  it("accepts exactly the statuses the database enum holds", () => {
    expect([...UNIT_STATUSES].sort()).toEqual(Object.values(UnitStatus).sort());
  });

  it("adds nothing to a partial update", () => {
    expect(updateUnitSchema.parse({ notes: "x" })).toEqual({ notes: "x" });
  });
});
