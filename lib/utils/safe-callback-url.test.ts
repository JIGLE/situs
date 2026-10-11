import { describe, it, expect } from "vitest";

import { safeCallbackUrl } from "./safe-callback-url";

describe("safeCallbackUrl", () => {
  it.each(["/dashboard", "/financials?tab=tax", "/portfolio?detail=property:1"])(
    "keeps the same-site path %s",
    (path) => {
      expect(safeCallbackUrl(path)).toBe(path);
    },
  );

  it.each([
    null,
    undefined,
    "",
    "dashboard",
    "https://evil.example/",
    "http://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
  ])("refuses %s", (raw) => {
    expect(safeCallbackUrl(raw)).toBeNull();
  });
});
