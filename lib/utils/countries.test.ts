import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, countryName, countryOptions } from "./countries";

describe("countryOptions", () => {
  it("names every ISO country in the app's language, Portugal first", () => {
    const pt = countryOptions("pt");

    expect(pt).toHaveLength(COUNTRY_CODES.length);
    expect(pt[0]).toEqual({ code: "PT", name: "Portugal" });
    expect(pt.find((option) => option.code === "DE")?.name).toBe("Alemanha");
    expect(countryOptions("it").find((option) => option.code === "DE")?.name).toBe("Germania");
  });

  it("sorts the rest by name in that language", () => {
    const names = countryOptions("es")
      .slice(1)
      .map((option) => option.name);

    expect(names).toEqual([...names].sort(new Intl.Collator("es").compare));
  });

  it("lists each code once, as two capital letters", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
  });
});

describe("countryName", () => {
  it("names one country in the app's language", () => {
    expect(countryName("PT", "en")).toBe("Portugal");
    expect(countryName("ES", "pt")).toBe("Espanha");
    expect(countryName("DE", "it")).toBe("Germania");
  });

  it("falls back to the code when Intl cannot name it", () => {
    expect(countryName("not a code", "en")).toBe("not a code");
  });
});
