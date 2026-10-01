import { describe, it, expect } from "vitest";
import {
  sanitizeHtml,
  sanitizeForDatabase,
  sanitizeFilename,
  sanitizeEmail,
  sanitizeOptionalEmail,
  sanitizeNumber,
} from "@/lib/utils/sanitize";

describe("sanitize utilities", () => {
  it("sanitizeHtml returns empty string for non-string or empty inputs", () => {
    expect(sanitizeHtml(null as unknown)).toBe("");
    expect(sanitizeHtml(undefined as unknown)).toBe("");
    expect(sanitizeHtml("")).toBe("");
  });

  it("sanitizeHtml strips tags", () => {
    const input = "<script>alert(1)</script><b>Hello</b>";
    expect(sanitizeHtml(input)).toBe("Hello");
  });

  it("sanitizeHtml never leaves a '<' in its output (no element can survive)", () => {
    const payloads = [
      "<script>alert(1)</script >x", // whitespace before close '>'
      "<SCRIPT>bad()</SCRIPT>ok", // uppercase
      "<script>x</script\n>after", // newline in close tag
      "<scr<script>ipt>alert(1)</script>tail", // reconstitution attempt
      "<img src=x onerror=alert(1)>caption", // attribute-based handler
      "<style>body{color:red}</style>visible", // style block content removed
      "<<script>alert(1)//<</script>", // nested angle brackets
    ];
    for (const p of payloads) {
      expect(sanitizeHtml(p)).not.toContain("<");
    }
  });

  it("sanitizeHtml removes script/style content while keeping surrounding text", () => {
    expect(sanitizeHtml("<style>body{}</style>visible")).toBe("visible");
    expect(sanitizeHtml("<SCRIPT>bad()</SCRIPT>ok")).toBe("ok");
    expect(sanitizeHtml("<script>x</script >tail")).toBe("tail");
  });

  it("sanitizeForDatabase trims and removes dangerous chars", () => {
    const input = "  <b>Test</b> & 'danger'\n";
    const out = sanitizeForDatabase(input);
    expect(out).toBe("Test danger");
  });

  it("sanitizeFilename normalizes filenames", () => {
    expect(sanitizeFilename("my@file/../name!.txt")).toBe(
      "my_file__name_.txt".replace(/__+/g, "_").replace(/^_+|_+$/g, ""),
    );
    expect(sanitizeFilename(null as unknown)).toBe("file");
  });

  it("sanitizeOptionalEmail takes a blank or missing email for none, and not an invalid one", () => {
    // None: a tenant read from Finanças has no address.
    for (const none of [undefined, null, "", "   ", 42]) {
      expect(sanitizeOptionalEmail(none)).toBeNull();
    }
    expect(sanitizeOptionalEmail(" Test@Example.COM ")).toBe("test@example.com");
    // Not none: `sanitizeEmail` answers null here too, and a route that took it would store nothing
    // for a mistyped address, in silence. It comes back as typed, for the schema to refuse.
    expect(sanitizeEmail(" BAD_EMAIL ")).toBeNull();
    expect(sanitizeOptionalEmail(" BAD_EMAIL ")).toBe("BAD_EMAIL");
  });

  it("sanitizeEmail returns null for invalid emails and lowercases valid ones", () => {
    expect(sanitizeEmail("BAD_EMAIL")).toBeNull();
    expect(sanitizeEmail(" Test@Example.COM ")).toBe("test@example.com");
  });

  it("sanitizeNumber handles non-numeric and respects min/max", () => {
    expect(sanitizeNumber("abc" as unknown, 5)).toBe(5);
    expect(sanitizeNumber("10" as unknown, 0, 0, 5)).toBe(5);
    expect(sanitizeNumber("2" as unknown, 0, 3)).toBe(3);
  });
});
