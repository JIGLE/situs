import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A main screen's heading is `PageHeader`, and nothing else writes an `h1` for one.
 *
 * The seven main screens each drew their own header: `text-2xl` bold on Settings, `text-3xl` bold
 * and hidden on a phone on People, semibold on Portfolio, a light greeting with no heading on the
 * dashboard, an `h2` on Leases. A screen has one heading (`CLAUDE.md`, Screen density), and the
 * mobile top bar was a second `h1` on top of the page's own.
 *
 * This reads the source and names file and line. Two rules:
 *   1. each main screen renders `PageHeader`;
 *   2. an `h1` is written in `PageHeader` and in the places named below, which are not main
 *      screens: the sign-in, second-factor and error pages, the legal pages, and the record
 *      detail views, whose heading is the record's own name.
 */
const root = join(import.meta.dirname, "..");

const MAIN_SCREENS = [
  "components/features/dashboard/overview-view.tsx",
  "components/features/assets/assets-view.tsx",
  "components/features/lease/leases-view.tsx",
  "components/features/financial/financials-container.tsx",
  "components/features/people/people-view.tsx",
  "components/features/settings/settings-view.tsx",
  "components/features/admin/admin-shell-nav.tsx",
  "components/features/completion/complete-view.tsx",
];

const H1_ALLOWED: Record<string, string> = {
  "components/shared/page-header.tsx": "the one place a main screen's heading is written",
  "components/features/auth/auth-view.tsx": "the sign-in and sign-up pages have their own frame",
  "app/auth/mfa/mfa-view.tsx": "the second-factor page has its own frame",
  "app/auth/error/page.tsx": "the sign-in error page has its own frame",
  "app/[locale]/privacy/page.tsx": "a legal page, outside the app shell",
  "app/[locale]/terms/page.tsx": "a legal page, outside the app shell",
  "components/features/property/property-detail-view.tsx": "a record's own name",
  "components/features/tenant/tenant-detail-view.tsx": "a record's own name",
  "components/features/lease/lease-detail-view.tsx": "a record's own name",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : walk(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** Lines that are code, not commentary. */
const codeLines = (source: string) =>
  source
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line));

describe("a main screen's heading is PageHeader", () => {
  it("renders PageHeader on every main screen", () => {
    const missing = MAIN_SCREENS.filter(
      (file) => !/<PageHeader[\s>]/.test(readFileSync(join(root, file), "utf8")),
    );
    expect(
      missing,
      `these main screens do not render <PageHeader>:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("writes an h1 only in PageHeader and the places named", () => {
    const found: string[] = [];
    for (const file of [...walk(join(root, "components")), ...walk(join(root, "app"))]) {
      const rel = relative(root, file);
      if (H1_ALLOWED[rel]) continue;
      for (const { line, number } of codeLines(readFileSync(file, "utf8"))) {
        if (/<h1[\s>]/.test(line)) found.push(`${rel}:${number}  ${line.trim().slice(0, 90)}`);
      }
    }
    expect(
      found,
      `a main screen's heading is <PageHeader>, not a bare <h1>:\n${found.join("\n")}`,
    ).toEqual([]);
  });
});
