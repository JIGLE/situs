import { describe, expect, it } from "vitest";
import { groupPins } from "./portfolio-map-pins";

describe("groupPins", () => {
  it("gives a building's units one pin with their count, and skips the unplaced", () => {
    const pins = groupPins([
      {
        id: "a",
        name: "R. Angola 25, 1º",
        status: "occupied",
        latitude: 38.7262,
        longitude: -9.131,
      },
      {
        id: "b",
        name: "R. Angola 25, 2º",
        status: "vacant",
        latitude: 38.726201,
        longitude: -9.131,
      },
      { id: "c", name: "Cascais", status: "vacant", latitude: 38.69, longitude: -9.42 },
      { id: "d", name: "No address", status: "vacant" },
    ]);
    expect(pins).toHaveLength(2);
    expect(pins[0]).toMatchObject({ ids: ["a", "b"], occupied: 1 });
    expect(pins[1]).toMatchObject({ ids: ["c"], occupied: 0 });
  });
});
