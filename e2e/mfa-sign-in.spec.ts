import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
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
 *
 * Turning the factor on also ends every session signed in before it (`session-epoch.ts`), and the
 * session that turned it on carries on by handing back a proof (`update({ keepProof })`). A device
 * signed in before is therefore made first, and must be refused afterwards. The shared
 * `storageState` file holds the old copy of the session that turned it on, which the rest of the
 * suite would read as ended, so it is rewritten with the renewed one.
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

/**
 * `/api/auth/**` is public to the proxy, so the TOTP routes check the CSRF token themselves: the
 * cookie `GET /api/csrf-token` sets, echoed in a header, as the app's own client does.
 */
async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  await request.get("/api/csrf-token");
  const { cookies } = await request.storageState();
  const token = cookies.find((c) => c.name === "csrf-token")?.value;
  expect(token, "no csrf-token cookie after GET /api/csrf-token").toBeTruthy();
  return { "x-csrf-token": token as string };
}

/**
 * Turning the factor on ended every session signed in before it. The one that turned it on carries
 * on by giving its own session the proof the route returned, as the Settings page does with
 * `update({ keepProof })`: a POST to NextAuth's session route with its CSRF token. The shared
 * `storageState` file still holds the old copy of this session, which the rest of the suite (and
 * the cleanup below) would read as ended, so it is rewritten with the renewed one.
 */
async function keepThisSession(request: APIRequestContext, keepProof: string) {
  const { csrfToken } = (await (await request.get("/api/auth/csrf")).json()) as {
    csrfToken: string;
  };
  const renewed = await request.post("/api/auth/session", {
    data: { csrfToken, data: { keepProof } },
  });
  expect(renewed.ok(), `POST /api/auth/session → ${renewed.status()}`).toBe(true);
  await request.storageState({ path: STORAGE_STATE });
}

test("an account with an authenticator app is held at the code page until it enters one", async ({
  browser,
  request,
  baseURL,
  playwright,
}) => {
  test.setTimeout(90_000);

  let enabled = false;
  let secret = "";
  // Another device of the same account, signed in before the factor is turned on.
  const device = await browser.newContext({
    baseURL: baseURL ?? undefined,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const devicePage = await device.newPage();
    await signInWithPassword(devicePage);
    await devicePage.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20_000 });
    expect((await device.request.get("/api/properties")).status()).toBe(200);

    const headers = await csrfHeaders(request);
    const setup = await request.post("/api/auth/totp/setup", { headers });
    expect(setup.ok(), `POST /api/auth/totp/setup → ${setup.status()}`).toBe(true);
    secret = ((await setup.json()) as { secret: string }).secret;

    const enable = await request.post("/api/auth/totp/enable", {
      headers,
      data: { code: totpGenerate(secret) },
    });
    expect(enable.ok(), `POST /api/auth/totp/enable → ${enable.status()}`).toBe(true);
    enabled = true;
    const { keepProof } = (await enable.json()) as { keepProof?: string };
    expect(keepProof, "the enable route returned no proof for this session").toBeTruthy();

    await test.step("turning it on ends the other device, and this session carries on", async () => {
      await keepThisSession(request, keepProof as string);

      // The device was signed in before: its session is over, however it asks.
      const ended = await device.request.get("/api/properties");
      expect(ended.status()).toBe(401);
      expect(await (await device.request.get("/api/auth/session")).json()).toEqual({});

      // The session that turned it on is still the owner's.
      expect((await request.get("/api/properties")).status()).toBe(200);
    });

    await test.step("a link cannot switch it off, and setup cannot replace what is on", async () => {
      // A GET is not a method of the route any more, so following a link does nothing.
      expect((await request.get("/api/auth/totp/setup")).status()).toBe(405);
      // Without the token the app's own client sends, a signed-in request is refused all the same.
      expect((await request.post("/api/auth/totp/setup")).status()).toBe(403);
      expect((await request.delete("/api/auth/totp/disable")).status()).toBe(403);
      // With the token, setup still leaves a second factor that is on alone.
      const again = await request.post("/api/auth/totp/setup", { headers });
      expect(again.status()).toBe(409);
      expect(await again.json()).toMatchObject({ reason: "totp_already_enabled" });

      // A signed-in session that passed the factor still cannot remove it without a code from it.
      expect((await request.delete("/api/auth/totp/disable", { headers })).status()).toBe(400);
      const wrong = totpGenerate(secret) === "000000" ? "111111" : "000000";
      expect(
        (
          await request.delete("/api/auth/totp/disable", { headers, data: { code: wrong } })
        ).status(),
      ).toBe(400);

      const status = await request.get("/api/auth/totp/status");
      expect(await status.json()).toMatchObject({ totpEnabled: true });
    });

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
    await device.close();
    if (enabled) {
      // A request context of its own: the test's is closed when the test times out, and the
      // account would be left asking for a code.
      const cleanup = await playwright.request.newContext({
        baseURL: baseURL ?? undefined,
        storageState: STORAGE_STATE,
      });
      try {
        const disable = await cleanup.delete("/api/auth/totp/disable", {
          headers: await csrfHeaders(cleanup),
          data: { code: totpGenerate(secret) },
          timeout: 15_000,
        });
        expect(disable.ok(), `DELETE /api/auth/totp/disable → ${disable.status()}`).toBe(true);
      } finally {
        await cleanup.dispose();
      }
    }
  }
});
