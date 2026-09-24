import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { canAccessPortalPath, normalizePortalPath } from "./access";

/**
 * `normalizePortalPath` used to take `segments[1]`, hardcoding the assumption that a language
 * segment came first. That was true while every URL was `/pt/portfolio` and false the moment the
 * address bar lost the prefix — and because `canAccessPortalPath` derives access from its result,
 * getting it wrong does not misroute, it DENIES. A silent lockout of every page.
 *
 * Both shapes are exercised here because both exist during the migration: the proxy 308s a
 * prefixed URL to the clean one, but the app's own hrefs still emit prefixes until they are
 * migrated, and server code sees the rewritten (prefixed) path either way.
 */
describe("normalising a portal path", () => {
  it("resolves the same destination with and without a locale", () => {
    // The property this file exists for. If these ever disagree, one of the two URL shapes is
    // denied access to a page the other can reach.
    for (const [prefixed, clean] of [
      ["/en/portfolio", "/portfolio"],
      ["/pt/settings", "/settings"],
      ["/es/admin", "/admin"],
      ["/it/people", "/people"],
    ]) {
      expect(normalizePortalPath(prefixed)).toBe(normalizePortalPath(clean));
    }
  });

  it("keeps only the first destination segment", () => {
    // Detail routes normalise to their section, which is what makes `/admin/users` reachable
    // through the `/admin` nav entry without listing every child.
    expect(normalizePortalPath("/en/admin/users")).toBe("/admin");
    expect(normalizePortalPath("/admin/users")).toBe("/admin");
    expect(normalizePortalPath("/portfolio/abc123")).toBe("/portfolio");
  });

  it("treats a bare root as the dashboard, prefixed or not", () => {
    expect(normalizePortalPath("/")).toBe("/dashboard");
    expect(normalizePortalPath("/en")).toBe("/dashboard");
    expect(normalizePortalPath("")).toBe("/dashboard");
  });

  it("does not mistake a destination for a locale", () => {
    // The failure mode of a naive "strip the first segment" fix: a section whose name is two
    // letters would be eaten. None exists today, which is exactly why it would go unnoticed.
    expect(normalizePortalPath("/people")).toBe("/people");
    expect(normalizePortalPath("/it")).toBe("/dashboard"); // a real locale, correctly stripped
    expect(normalizePortalPath("/is/something")).toBe("/is"); // not a supported locale
  });

  it("still applies the legacy route aliases", () => {
    // These predate the prefix change and must survive it — old deep links depend on them.
    expect(normalizePortalPath("/en/properties")).toBe("/portfolio");
    expect(normalizePortalPath("/properties")).toBe("/portfolio");
  });
});

describe("access derived from the normalised path", () => {
  it("grants the nav pages under either URL shape", () => {
    for (const path of ["/portfolio", "/settings", "/admin", "/people", "/financials", "/leases"]) {
      expect(canAccessPortalPath(path)).toBe(true);
      expect(canAccessPortalPath(`/en${path}`)).toBe(true);
    }
  });

  /**
   * This suite used to assert a tenant out of owner-only pages, because
   * `canAccessPortalPath` took a role and a mis-normalised path would have been a privilege
   * escalation. The scope cutdown removed tenant access, so there is one role and that
   * assertion has nothing left to compare.
   *
   * What replaces it is the property that still has to hold: the function can say no. A
   * version that returned true for everything would be indistinguishable from a working one
   * at every call site, since `PortalAccessGuard` only ever asks about routes that exist.
   */
  it("still refuses a path that is not a nav destination, under either shape", () => {
    for (const path of ["/nope", "/portfolios", "/admin-panel", "/settings-old"]) {
      expect(canAccessPortalPath(path)).toBe(false);
      expect(canAccessPortalPath(`/en${path}`)).toBe(false);
    }
  });
});

/**
 * The trap this suite exists to close, generalised.
 *
 * `PortalAccessGuard` replaces any route `canAccessPortalPath` rejects with /dashboard, and that
 * verdict comes from `PORTAL_NAV_GROUPS` plus the alias table. A redirect-only stub belongs to
 * neither: it is not a nav destination, and until someone remembers the alias it is unreachable
 * no matter what it renders. The guard wins the race against the stub's own `redirect()`.
 *
 * /admin hit this. /buildings and /contracts then hit it again, and both sat broken through
 * several passes because the page source looks completely correct — the fault is in another file
 * entirely, and nothing connected the two.
 *
 * So the stubs are discovered from the filesystem rather than listed here. A new one added
 * without an alias fails this test on the commit that adds it.
 */
describe("redirect-only routes survive the portal access guard", () => {
  const APP_DIR = path.join(process.cwd(), "app", "[locale]", "(main)");

  const stubs: { route: string; target: string }[] = [];
  for (const entry of readdirSync(APP_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("[")) continue;
    const page = path.join(APP_DIR, entry.name, "page.tsx");
    if (!existsSync(page)) continue;
    const source = readFileSync(page, "utf8");
    // A stub forwards and renders nothing else: it imports `redirect` and has no JSX.
    if (!/from "next\/navigation"/.test(source) || !/\bredirect\(/.test(source)) continue;
    if (/return\s*\(/.test(source)) continue;
    const target = source.match(/redirect\(\s*["'`]([^"'`]+)["'`]\s*\)/)?.[1] ?? "";
    stubs.push({ route: `/${entry.name}`, target });
  }

  it("finds the stubs (a zero-length sweep would pass every assertion below)", () => {
    expect(stubs.length).toBeGreaterThanOrEqual(2);
    expect(stubs.map((s) => s.route)).toEqual(expect.arrayContaining(["/buildings", "/contracts"]));
  });

  it.each(stubs)("$route is reachable and forwards to $target", ({ route, target }) => {
    // Reachable: the guard must not bounce the route before the redirect runs. This is the whole
    // bug. Note it is NOT required that the alias equal the target — a stub may be a nav
    // destination in its own right whose page happens to forward somewhere else, and that is
    // fine. What matters is only that the guard lets the route render at all.
    expect(canAccessPortalPath(route)).toBe(true);

    // Canonical target: a relative path is never resolved by the client router, and a
    // locale-prefixed one earns a 308 from the proxy that the router does not survive.
    expect(target).toMatch(/^\/[a-z]/);
    expect(target).not.toMatch(/^\/(pt|en|es|it)\//);
  });

  it("aliases the two stubs that are not nav destinations to where they forward", () => {
    // These two have no nav entry of their own, so the alias table is the only thing making them
    // reachable, and it must name the page they actually go to.
    expect(normalizePortalPath("/buildings")).toBe("/portfolio");
    expect(normalizePortalPath("/contracts")).toBe("/leases");
  });
});
