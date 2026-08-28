import { test, expect } from "@playwright/test";
import { settle } from "./helpers/wait";

test.describe("API Health", () => {
  test("ready endpoint should return ok", async ({ request }) => {
    const response = await request.get("/api/ready");

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe("ok");
  });

  test("info endpoint should return version", async ({ request }) => {
    const response = await request.get("/api/info");

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty("version");
  });
});

test.describe("Authentication", () => {
  test("signin page should be accessible", async ({ page }) => {
    await page.goto("/auth/signin");

    await settle(page);

    // Page should have loaded successfully
    const hasContent = await page.locator("body").textContent();
    expect(hasContent).toBeTruthy();

    // The URL should reflect the signin route or a redirect
    const currentUrl = page.url();
    expect(currentUrl).toContain("localhost");
  });

  test("unauthenticated API requests should not return success data", async ({ request }) => {
    // Try to access protected endpoint without auth
    const response = await request.get("/api/properties", {
      headers: {
        // No auth headers
      },
    });

    // Should be unauthorized, redirect, or server error — never a successful data response
    const status = response.status();
    expect(status === 200 && (await response.text()).startsWith("[")).toBeFalsy();
  });

  /**
   * The portal auth guard lives in `proxy.ts`, and it was silently switched off for a while:
   * it keyed on `pathname.split("/")[1]` being a supported locale, which stopped being true the
   * moment URLs lost their prefix. Nothing failed loudly — `/dashboard` simply routed as
   * `[locale] = "dashboard"` and served the marketing page with a 200, so a signed-out visitor
   * got the landing page instead of the sign-in form and no test noticed.
   *
   * `?tab=tax` is here for a second reason: canonical financial tabs took an early return out of
   * the middleware, ahead of the guard AND ahead of the locale rewrite, so that one URL was
   * doubly broken. Both shapes must reach sign-in.
   */
  for (const path of ["/dashboard", "/financials?tab=tax"]) {
    test(`${path} sends a signed-out visitor to sign-in`, async ({ page }) => {
      await page.goto(path);

      const url = new URL(page.url());
      expect(url.pathname, `${path} should not render for a signed-out visitor`).toBe(
        "/auth/signin",
      );
      expect(url.searchParams.get("callbackUrl")).toBeTruthy();
      await expect(page.locator('input[name="email"]')).toBeVisible();
    });
  }
});

/**
 * These two used to visit `/en` and `/pt` and assert only that the page had a title, which was
 * true of the sign-in page and of a 404 alike. URLs carry no locale segment any more, so what is
 * worth asserting is the back-compat path instead: a bookmarked prefixed URL still resolves, via
 * one redirect, to the unprefixed equivalent, and the locale it named is remembered in the cookie
 * the proxy reads on the next request.
 */
/**
 * The bank consent callback never sends the browser to an absolute URL.
 *
 * It used to build `new URL(path, request.nextUrl.origin)`, and in the standalone server that
 * origin is reconstructed from HOSTNAME/PORT and forwarded headers — so behind a reverse proxy it
 * resolved to `https://0.0.0.0:3000`, the container's BIND address. The consent completed and the
 * operator then landed on ERR_ADDRESS_INVALID: the worst place to fail, because the work was done
 * and only the last hop was unreachable.
 *
 * A relative reference is resolved by the browser against the URL it actually requested, so it
 * cannot name a host the browser cannot reach. That is the property asserted here, and the
 * assertion is about the SHAPE of the Location rather than its destination.
 *
 * This block needs a session: the route answers 401 without one, and the redirect — the thing
 * under test — only exists past the auth check. The reference is deliberately junk, so the
 * failure branch runs and no consent is completed. The rest of this file stays signed out on
 * purpose, so the storage state is opted into here rather than set for the file.
 */
test.describe("Bank consent callback", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  test("redirects relatively, never to a reconstructed origin", async ({ page }) => {
    const response = await page.request.get("/api/bank/connections/callback?state=nope", {
      maxRedirects: 0,
    });

    const location = response.headers()["location"];
    expect(location, "the callback should redirect somewhere").toBeTruthy();
    expect(location, `Location must be relative, got ${location}`).not.toMatch(/^https?:\/\//);
    expect(location.startsWith("/")).toBe(true);
  });
});

/**
 * `/demo` is reachable in a bounded number of hops.
 *
 * It used to redirect to `/${defaultLocale}/demo`, which was correct while pages lived at
 * prefixed URLs. Once the prefix left the address bar it became a loop — that hop produced
 * `/pt/demo`, and the back-compat rule 308s any prefixed URL back to its unprefixed form — so
 * every entry into demo mode (the landing hero, the PWA welcome, the sign-in page) dead-ended in
 * ERR_TOO_MANY_REDIRECTS.
 *
 * Playwright surfaces that as a navigation error rather than a failed assertion, so `goto`
 * itself is the assertion here: the test cannot pass if the URL does not resolve.
 */
test.describe("Demo entry", () => {
  test("/demo resolves without a redirect loop", async ({ page }) => {
    const response = await page.goto("/demo?perspective=owner");

    expect(response?.ok(), "/demo should resolve").toBe(true);
    // Whatever demo mode does next, it must not have been reached through the prefixed URL that
    // bounces — landing back on `/demo` or moving on into the app are both fine.
    expect(new URL(page.url()).pathname).not.toMatch(/^\/(pt|en|es|it)(\/|$)/);
  });
});

test.describe("Localization", () => {
  for (const locale of ["en", "pt"] as const) {
    test(`/${locale} redirects to the unprefixed URL and remembers the locale`, async ({
      page,
    }) => {
      const response = await page.goto(`/${locale}`);

      expect(new URL(page.url()).pathname).toBe("/");
      expect(response?.ok()).toBe(true);

      const cookie = (await page.context().cookies()).find((c) => c.name === "situs-locale");
      expect(cookie?.value, `/${locale} should record the locale it named`).toBe(locale);
    });
  }
});
