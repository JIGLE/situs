import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { stripLocalePrefix } from "@/lib/hooks/use-route-pathname";

/**
 * `usePathname` from `next/navigation` returns the proxy's rewritten `/pt/...` path on the server
 * and the bare one in the browser, so anything rendered from it fails hydration on every page.
 * Components read the route through `useRoutePathname` instead.
 */
describe("route pathname", () => {
  it("strips the locale segment and nothing else", () => {
    expect(stripLocalePrefix("/pt/settings")).toBe("/settings");
    expect(stripLocalePrefix("/pt")).toBe("/");
    expect(stripLocalePrefix("/es/portfolio/abc")).toBe("/portfolio/abc");
    expect(stripLocalePrefix("/settings")).toBe("/settings");
    expect(stripLocalePrefix("/ptx/settings")).toBe("/ptx/settings");
    expect(stripLocalePrefix("/portfolio/pt")).toBe("/portfolio/pt");
  });

  it("no component reads usePathname from next/navigation directly", () => {
    const files = execSync("git ls-files 'app/**/*.tsx' 'app/**/*.ts' 'components/**' 'lib/**'", {
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => f !== "lib/hooks/use-route-pathname.ts");
    const offenders = files.filter((f) =>
      /import\s*\{[^}]*\busePathname\b[^}]*\}\s*from\s*"next\/navigation"/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
