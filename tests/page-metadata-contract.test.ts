import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every page that renders names itself in the tab.
 *
 * Only the privacy and terms pages set a title, so every other tab, history entry and bookmark
 * read "Situs — Sovereign Capital System" whatever it showed. Nothing caught it: a page with no
 * metadata type-checks, builds and renders. This reads each `page.tsx` under `app/` and asks for
 * `generateMetadata` (or `metadata`), on the page or on a layout beside it for a client page that
 * cannot export one (the auth error page).
 *
 * A page that only redirects renders nothing, so it has no tab to name. It is told apart by
 * having a `redirect(` and no JSX return.
 */
const ROOT = join(import.meta.dirname, "..");
const APP = join(ROOT, "app");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "api" ? [] : pages(full);
    return name === "page.tsx" ? [full] : [];
  });
}

const METADATA =
  /export\s+(async\s+function\s+generateMetadata|function\s+generateMetadata|const\s+metadata)\b/;

/** True when the page's own source renders nothing but a redirect. */
function onlyRedirects(source: string): boolean {
  return /\bredirect\(/.test(source) && !/return\s*\(?\s*</.test(source);
}

function hasMetadata(page: string): boolean {
  if (METADATA.test(readFileSync(page, "utf8"))) return true;
  const layout = join(page, "..", "layout.tsx");
  return existsSync(layout) && METADATA.test(readFileSync(layout, "utf8"));
}

const rendering = pages(APP)
  .filter((page) => !onlyRedirects(readFileSync(page, "utf8")))
  .map((page) => relative(ROOT, page));

describe("page metadata", () => {
  it("finds the pages (so a layout change cannot empty this test)", () => {
    expect(rendering.length).toBeGreaterThan(15);
    expect(rendering).toContain("app/[locale]/(main)/dashboard/page.tsx");
    expect(rendering).toContain("app/auth/signin/page.tsx");
  });

  it.each(rendering)("%s sets a title", (page) => {
    expect(hasMetadata(join(ROOT, page)), `${page} exports no generateMetadata or metadata`).toBe(
      true,
    );
  });

  it("leaves a page that only redirects alone", () => {
    expect(rendering).not.toContain("app/[locale]/(main)/tenants/page.tsx");
    expect(rendering).not.toContain("app/[locale]/page.tsx");
  });
});
