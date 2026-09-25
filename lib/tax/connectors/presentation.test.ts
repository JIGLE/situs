import { describe, expect, it } from "vitest";
import { MODE_KIND_STYLES, modeKind } from "./presentation";

describe("modeKind", () => {
  it("files sandbox and review as simulated, test as the authority's test service", () => {
    expect(modeKind("sandbox")).toBe("simulated");
    expect(modeKind("review")).toBe("simulated");
    expect(modeKind("test")).toBe("test");
  });

  it("files everything else as unsupported, live included, since nothing honours it", () => {
    for (const mode of ["live", "Live", "production", "at_test", "test ", ""]) {
      expect(modeKind(mode)).toBe("unsupported");
    }
  });

  it("never paints a kind in the success colour: none of them files for real", () => {
    for (const style of Object.values(MODE_KIND_STYLES)) {
      expect(style).not.toMatch(/success/);
    }
  });
});
