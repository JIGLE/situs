// @vitest-environment node
/**
 * Every page under `app/[locale]/(main)` is behind sign-in.
 *
 * `isMainPortalPage` in `proxy.ts` is a list of path prefixes, so a page added without a line
 * there is served to a signed-out visitor: the page loads, its data calls answer 401, and nothing
 * says the guard is missing. This walks the folders instead of trusting the list, so a new page
 * fails here, by name, until the list knows it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { TEST_NEXTAUTH_SECRET } from "./helpers/session";

const MAIN = join(process.cwd(), "app", "[locale]", "(main)");

/** Folders that are not pages: route groups and parallel slots. */
const isPage = (name: string) =>
  statSync(join(MAIN, name)).isDirectory() && !name.startsWith("(") && !name.startsWith("@");

/** A page that only redirects, to one the proxy does guard. Each needs its reason. */
const REDIRECT_ONLY: Record<string, string> = {
  account: "redirects to /settings?tab=account",
};

const pages = readdirSync(MAIN).filter(isPage);

async function run(path: string) {
  const { proxy } = await import("../proxy");
  return proxy(new NextRequest(new URL(path, "https://example.test")));
}

// The first import of the proxy pulls in next/server, the CSRF module and next-auth/jwt; the
// budget is for that module graph, not for the assertions.
describe("proxy: the portal pages", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_SECRET", TEST_NEXTAUTH_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("finds the pages, so an empty walk cannot pass for a guarded one", () => {
    expect(pages).toEqual(expect.arrayContaining(["dashboard", "financials", "settings"]));
    expect(Object.keys(REDIRECT_ONLY).every((name) => pages.includes(name))).toBe(true);
  });

  it.each(pages.filter((name) => !(name in REDIRECT_ONLY)))(
    "sends a signed-out visitor from /%s to sign-in",
    async (name) => {
      const res = await run(`/${name}`);

      expect(res.status, `app/[locale]/(main)/${name} needs a line in isMainPortalPage`).toBe(307);
      expect(new URL(res.headers.get("location") as string).pathname).toBe("/auth/signin");
    },
  );
});
