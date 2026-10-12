import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The legal pages follow the theme like every other page.
 *
 * Privacy and Terms hardcoded a dark `zinc` palette (`bg-zinc-950`, `text-zinc-300`, an indigo
 * eyebrow), so a visitor on the cream light theme tapped "Terms" or "Privacy" on the sign-in page and
 * landed on a black page. They take their colours from the same tokens as the rest of the app, which
 * is also what the contrast tests measure. This reads the source and names file and line.
 */
const root = join(import.meta.dirname, "..");
const PAGES = ["app/[locale]/privacy/page.tsx", "app/[locale]/terms/page.tsx"];

const FIXED_COLOUR =
  /(?<![\w-])(?:bg|text|border|ring|from|to)-(?:zinc|slate|gray|neutral|stone|indigo|violet|blue|green|red|amber)-\d|(?<![\w-])(?:bg|text|border)-(?:white|black)(?:\/|\b)|border-white\//;

describe("the legal pages follow the theme", () => {
  it.each(PAGES)("%s uses no fixed palette colour", (page) => {
    const offenders: string[] = [];
    readFileSync(join(root, page), "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (FIXED_COLOUR.test(line))
          offenders.push(`${page}:${index + 1}  ${line.trim().slice(0, 90)}`);
      });
    expect(offenders, `use the theme tokens:\n${offenders.join("\n")}`).toEqual([]);
  });

  it.each(PAGES)("%s paints its page with the theme background", (page) => {
    expect(readFileSync(join(root, page), "utf8")).toContain("bg-[var(--color-background)]");
  });

  it.each(PAGES)("%s does not blur its header", (page) => {
    expect(readFileSync(join(root, page), "utf8")).not.toMatch(/backdrop-blur/);
  });
});
