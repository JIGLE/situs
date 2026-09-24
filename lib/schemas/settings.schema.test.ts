import { describe, expect, it } from "vitest";
import { updateSettingsSchema } from "./settings.schema";

describe("settings schema", () => {
  it("adds nothing to a partial update", () => {
    expect(updateSettingsSchema.parse({ emailNotifications: false })).toEqual({
      emailNotifications: false,
    });
  });
});
