import { test, expect } from "@playwright/test";
import { totpGenerate } from "../lib/utils/totp";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * An account with an authenticator app is not signed in until it has entered a code.
 *
 * Settings promised "you will need a code each time", and nothing kept it: `mfaPending` was set on
 * the session at sign-in and read by no one on the server, and nothing sent the user to the code
 * page. The proxy and `requireAuth` now refuse such a session, and the proxy leads it to
 * `/auth/mfa`.
 *
 * The signed-in demo account turns TOTP on through its own session (which carries no
 * `mfaPending`, so the rest of the suite is untouched), signs in again in a clean browser context,
 * and is held at the code page. The `finally` turns it off again: the account is shared, and the
 * next sign-in anywhere would otherwise ask for a code.
 */

const EMAIL = process.env.E2E_USER_EMAIL || "demo@situs.local";
const PASSWORD = process.env.E2E_USER_PASSWORD || "demo123";

test("an account with an authenticator app is held at the code page until it enters one", async ({
  browser,
  request,
  baseURL,
}) => {
  let enabled = false;
  try {
    const setup = await request.get("/api/auth/totp/setup");
    expect(setup.ok(), `GET /api/auth/totp/setup → ${setup.status()}`).toBe(true);
    const { secret } = (await setup.json()) as { secret: string };

    const enable = await request.post("/api/auth/totp/enable", {
      data: { code: totpGenerate(secret) },
    });
    expect(enable.ok(), `POST /api/auth/totp/enable → ${enable.status()}`).toBe(true);
    enabled = true;

    // A new browser context has no session: the same account signing in from somewhere else.
    const context = await browser.newContext({ baseURL: baseURL ?? undefined });
    try {
      const page = await context.newPage();
      await page.goto("/auth/signin", { waitUntil: "domcontentloaded" });
      await page.locator('input[name="email"]').fill(EMAIL);
      await page.locator('input[name="password"]').fill(PASSWORD);
      await page.locator('form button[type="submit"]').click();

      await test.step("the first factor leads to the code page, not the app", async () => {
        await page.waitForURL((url) => url.pathname === "/auth/mfa", { timeout: 20000 });
        await expect(page.locator('input[name="code"]')).toBeVisible();
      });

      await test.step("until the code is entered the API refuses the session, and a page leads back", async () => {
        const blocked = await page.request.get("/api/properties");
        expect(blocked.status()).toBe(401);
        expect(await blocked.json()).toMatchObject({ reason: "mfa_required" });

        // The second factor cannot be removed with the first alone.
        const disable = await page.request.delete("/api/auth/totp/disable");
        expect(disable.status()).toBe(401);

        await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
        await page.waitForURL((url) => url.pathname === "/auth/mfa");
      });

      await test.step("a wrong code is refused on the page, in words", async () => {
        await page.locator('input[name="code"]').fill("000000");
        await page.locator('form button[type="submit"]').click();
        await expect(page.getByRole("alert")).toBeVisible();
        expect(new URL(page.url()).pathname).toBe("/auth/mfa");
      });

      await test.step("the right code opens the app, and the API with it", async () => {
        await page.locator('input[name="code"]').fill(totpGenerate(secret));
        await page.locator('form button[type="submit"]').click();
        await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20000 });

        const allowed = await page.request.get("/api/properties");
        expect(allowed.status()).toBe(200);
      });
    } finally {
      await context.close();
    }
  } finally {
    if (enabled) {
      const disable = await request.delete("/api/auth/totp/disable");
      expect(disable.ok(), `DELETE /api/auth/totp/disable → ${disable.status()}`).toBe(true);
    }
  }
});
