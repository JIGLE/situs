import { test, expect, type Page } from "@playwright/test";
import { totpGenerate } from "../lib/utils/totp";

const STORAGE_STATE = "playwright/.auth/user.json";

test.use({ storageState: STORAGE_STATE });

/**
 * An account with an authenticator app is not signed in until it has entered a code.
 *
 * Settings promised "you will need a code each time", and nothing kept it: `mfaPending` was set on
 * the session at sign-in and read by no one on the server, and nothing sent the user to the code
 * page. The proxy and `requireAuth` now refuse such a session, and the proxy leads it to
 * `/auth/mfa`.
 *
 * The signed-in demo account turns TOTP on through its own session (which carries no
 * `mfaPending`, so the rest of the suite is untouched), signs in again in a context with no
 * session, and is held at the code page. The `finally` turns it off again: the account is shared,
 * and the next sign-in anywhere would otherwise ask for a code.
 *
 * A code entered by one session releases that session and no other. It used to be recorded on the
 * account, and any session that refreshed in the next five minutes was released by it: the second
 * run of this file, a minute after the first, found its sign-in already let through. So after the
 * code is entered, a third sign-in with only the password is made at once and must still be held.
 */

const EMAIL = process.env.E2E_USER_EMAIL || "demo@situs.local";
const PASSWORD = process.env.E2E_USER_PASSWORD || "demo123";

/** Actions here have no timeout of their own in this config, so a missing element would wait out the whole test. */
const STEP = { timeout: 15_000 };

/** The first factor, on a page with no session. */
async function signInWithPassword(page: Page) {
  await page.goto("/auth/signin", { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(EMAIL, STEP);
  await page.locator('input[name="password"]').fill(PASSWORD, STEP);
  await page.locator('form button[type="submit"]').click(STEP);
}

test("an account with an authenticator app is held at the code page until it enters one", async ({
  browser,
  request,
  baseURL,
  playwright,
}) => {
  test.setTimeout(90_000);

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

    // A context made through `browser` takes this file's `storageState` as well, which is the
    // signed-in demo account: sign-in would redirect straight to the dashboard and the form below
    // would never appear. An empty one is what makes this the same account signing in again from
    // somewhere else.
    const context = await browser.newContext({
      baseURL: baseURL ?? undefined,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const page = await context.newPage();
      await signInWithPassword(page);

      await test.step("the first factor leads to the code page, not the app", async () => {
        await page.waitForURL((url) => url.pathname === "/auth/mfa", { timeout: 20_000 });
        await expect(page.locator('input[name="code"]')).toBeVisible(STEP);
      });

      await test.step("until the code is entered the API refuses the session, and a page leads back", async () => {
        const blocked = await page.request.get("/api/properties");
        expect(blocked.status()).toBe(401);
        expect(await blocked.json()).toMatchObject({ reason: "mfa_required" });

        // The second factor cannot be removed with the first alone.
        const disable = await page.request.delete("/api/auth/totp/disable");
        expect(disable.status()).toBe(401);

        await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
        await page.waitForURL((url) => url.pathname === "/auth/mfa", { timeout: 20_000 });
      });

      await test.step("a wrong code is refused on the page, in words", async () => {
        await page.locator('input[name="code"]').fill("000000", STEP);
        await page.locator('form button[type="submit"]').click(STEP);
        // Scoped to the form: Next's route announcer is an alert of its own.
        await expect(page.locator('form [role="alert"]')).toBeVisible(STEP);
        expect(new URL(page.url()).pathname).toBe("/auth/mfa");
      });

      await test.step("the right code opens the app, and the API with it", async () => {
        await page.locator('input[name="code"]').fill(totpGenerate(secret), STEP);
        await page.locator('form button[type="submit"]').click(STEP);
        await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20_000 });

        const allowed = await page.request.get("/api/properties");
        expect(allowed.status()).toBe(200);
      });

      await test.step("a sign-in with only the password, a moment after, is still held", async () => {
        const elsewhere = await browser.newContext({
          baseURL: baseURL ?? undefined,
          storageState: { cookies: [], origins: [] },
        });
        try {
          const other = await elsewhere.newPage();
          await signInWithPassword(other);

          // Held at the code page, which reads the session as it loads: the read that used to
          // release it. If it were released, the page would leave and the box would never show.
          await other.waitForURL((url) => url.pathname === "/auth/mfa", { timeout: 20_000 });
          await expect(other.locator('input[name="code"]')).toBeVisible(STEP);

          const blocked = await other.request.get("/api/properties");
          expect(blocked.status()).toBe(401);
          expect(await blocked.json()).toMatchObject({ reason: "mfa_required" });
        } finally {
          await elsewhere.close();
        }
      });
    } finally {
      await context.close();
    }
  } finally {
    if (enabled) {
      // A request context of its own: the test's is closed when the test times out, and the
      // account would be left asking for a code.
      const cleanup = await playwright.request.newContext({
        baseURL: baseURL ?? undefined,
        storageState: STORAGE_STATE,
      });
      try {
        const disable = await cleanup.delete("/api/auth/totp/disable", { timeout: 15_000 });
        expect(disable.ok(), `DELETE /api/auth/totp/disable → ${disable.status()}`).toBe(true);
      } finally {
        await cleanup.dispose();
      }
    }
  }
});
