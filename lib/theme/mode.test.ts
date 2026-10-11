// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { MODE_COOKIE, normalizeMode } from "./mode";
import { readModeCookie, writeModeCookie } from "./mode-cookie";

describe("normalizeMode", () => {
  it.each([
    ["normal", "normal"],
    ["light", "normal"],
    ["dark", "dark"],
    ["dark-oled", "dark"],
    ["system", "system"],
  ])("reads %s as %s", (stored, expected) => {
    expect(normalizeMode(stored)).toBe(expected);
  });

  it.each([null, undefined, "", "Dark", "sepia", "1"])("reads %s as no choice", (stored) => {
    expect(normalizeMode(stored)).toBeNull();
  });
});

describe("the mode cookie", () => {
  beforeEach(() => {
    document.cookie = `${MODE_COOKIE}=; Path=/; Max-Age=0`;
  });

  it("is empty until a device chooses", () => {
    expect(readModeCookie()).toBeNull();
  });

  it("round-trips each choice", () => {
    for (const mode of ["normal", "dark", "system"] as const) {
      expect(writeModeCookie(mode)).toBe(true);
      expect(readModeCookie()).toBe(mode);
    }
  });

  it("ignores a value that is not a theme", () => {
    document.cookie = `${MODE_COOKIE}=hotpink; Path=/`;

    expect(readModeCookie()).toBeNull();
  });
});
