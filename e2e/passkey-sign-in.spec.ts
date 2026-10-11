import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { totpGenerate } from "../lib/utils/totp";

const STORAGE_STATE = "playwright/.auth/user.json";

test.use({ storageState: STORAGE_STATE });

/**
 * A passkey is a quicker way past the second factor: one tap instead of a code.
 *
 * The browser here is Chromium with a virtual authenticator (the DevTools WebAuthn domain): it holds
 * real keys and signs real challenges, so the whole ceremony runs, the signature check on the server
 * included. Nothing is stubbed.
 *
 * The signed-in demo account turns the authenticator app on through its own session (as
 * `mfa-sign-in.spec.ts` does), saves a passkey from Settings › Security, then signs in again with
 * only its password and is held at the code page, where the passkey opens the app. The `finally`
 * turns the app off again, which removes the passkeys: the account is shared.
 */

const EMAIL = process.env.E2E_USER_EMAIL || "demo@situs.local";
const PASSWORD = process.env.E2E_USER_PASSWORD || "demo123";
const STEP = { timeout: 15_000 };

async function signInWithPassword(page: Page) {
  await page.goto("/auth/signin", { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(EMAIL, STEP);
  await page.locator('input[name="password"]').fill(PASSWORD, STEP);
  await page.locator('form button[type="submit"]').click(STEP);
}

async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  await request.get("/api/csrf-token");
  const { cookies } = await request.storageState();
  const token = cookies.find((c) => c.name === "csrf-token")?.value;
  expect(token, "no csrf-token cookie after GET /api/csrf-token").toBeTruthy();
  return { "x-csrf-token": token as string };
}

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

/** A phone's own authenticator: it checks the person (fingerprint, face or lock) and says yes. */
async function addAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return cdp;
}

test("a passkey opens the code page, and the authenticator app stays the way in without it", async ({
  browser,
  request,
  baseURL,
  playwright,
}) => {
  test.setTimeout(120_000);

  let enabled = false;
  let secret = "";
  try {
    const headers = await csrfHeaders(request);
    const setup = await request.post("/api/auth/totp/setup", { headers });
    expect(setup.ok(), `POST /api/auth/totp/setup → ${setup.status()}`).toBe(true);
    secret = ((await setup.json()) as { secret: string }).secret;

    await test.step("a passkey cannot be added before the authenticator app is on", async () => {
      const early = await request.post("/api/auth/passkey/register/options", {
        headers,
        data: { code: totpGenerate(secret) },
      });
      expect(early.status()).toBe(409);
      expect(await early.json()).toMatchObject({ reason: "totp_required" });
    });

    const enable = await request.post("/api/auth/totp/enable", {
      headers,
      data: { code: totpGenerate(secret) },
    });
    expect(enable.ok(), `POST /api/auth/totp/enable → ${enable.status()}`).toBe(true);
    enabled = true;
    await keepThisSession(request, ((await enable.json()) as { keepProof: string }).keepProof);

    await test.step("adding one takes a code from the app, and a held session has none", async () => {
      const noToken = await request.post("/api/auth/passkey/register/options", {
        data: { code: totpGenerate(secret) },
      });
      expect(noToken.status()).toBe(403);

      const wrong = totpGenerate(secret) === "000000" ? "111111" : "000000";
      const refused = await request.post("/api/auth/passkey/register/options", {
        headers,
        data: { code: wrong },
      });
      expect(refused.status()).toBe(400);

      // A signed-in session is not waiting for a second factor, so it cannot use the sign-in routes.
      const notWaiting = await request.post("/api/auth/passkey/authenticate/options");
      expect(notWaiting.status()).toBe(409);
      expect(await notWaiting.json()).toMatchObject({ reason: "mfa_not_pending" });
    });

    // One browser context for both halves: the virtual authenticator that saves the passkey is the
    // one that signs in with it, as a phone is.
    const context = await browser.newContext({
      baseURL: baseURL ?? undefined,
      storageState: STORAGE_STATE,
    });
    try {
      const page = await context.newPage();
      await addAuthenticator(page);

      await test.step("Settings › Security saves a passkey from this device", async () => {
        await page.goto("/settings?tab=security", { waitUntil: "domcontentloaded" });
        await page.getByTestId("passkey-add").click(STEP);
        await page.locator("#passkey-name").fill("E2E phone", STEP);
        await page.locator("#passkey-code").fill(totpGenerate(secret), STEP);
        await page.getByTestId("passkey-save").click(STEP);

        const list = page.getByTestId("passkey-list");
        await expect(list).toContainText("E2E phone", STEP);

        const listed = await context.request.get("/api/auth/passkey");
        const body = (await listed.json()) as { passkeys: Array<Record<string, unknown>> };
        expect(body.passkeys).toHaveLength(1);
        // Never the credential or its key.
        expect(Object.keys(body.passkeys[0]).sort()).toEqual([
          "createdAt",
          "id",
          "lastUsedAt",
          "name",
          "synced",
        ]);
      });

      await test.step("signing in again with only the password is held, and offers the passkey", async () => {
        await context.clearCookies();
        await signInWithPassword(page);
        await page.waitForURL((url) => url.pathname === "/auth/mfa", { timeout: 20_000 });
        await expect(page.getByTestId("passkey-sign-in")).toBeVisible(STEP);

        const blocked = await page.request.get("/api/properties");
        expect(blocked.status()).toBe(401);
        expect(await blocked.json()).toMatchObject({ reason: "mfa_required" });
      });

      await test.step("a challenge made for one sign-in releases no other", async () => {
        // Another device of the same account, held at the same page, with its own session.
        const elsewhere = await browser.newContext({
          baseURL: baseURL ?? undefined,
          storageState: { cookies: [], origins: [] },
        });
        try {
          const other = await elsewhere.newPage();
          await signInWithPassword(other);
          await other.waitForURL((url) => url.pathname === "/auth/mfa", { timeout: 20_000 });

          const mine = await page.request.post("/api/auth/passkey/authenticate/options");
          expect(mine.ok()).toBe(true);
          const { token } = (await mine.json()) as { token: string };

          const stolen = await other.request.post("/api/auth/passkey/authenticate/verify", {
            data: { token, response: { id: "anything" } },
          });
          expect(stolen.status()).toBe(400);
          expect(await stolen.json()).toMatchObject({ reason: "passkey_challenge_expired" });
          expect((await other.request.get("/api/properties")).status()).toBe(401);
        } finally {
          await elsewhere.close();
        }
      });

      await test.step("the passkey opens the app, and the API with it", async () => {
        await page.getByTestId("passkey-sign-in").click(STEP);
        await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20_000 });
        expect((await page.request.get("/api/properties")).status()).toBe(200);
      });

      await test.step("a passkey that is removed no longer offers itself, and removal takes a code", async () => {
        const list = (await (await page.request.get("/api/auth/passkey")).json()) as {
          passkeys: Array<{ id: string; lastUsedAt: string | null }>;
        };
        expect(list.passkeys[0].lastUsedAt).not.toBeNull();

        const csrf = await csrfHeaders(page.request);
        const id = list.passkeys[0].id;
        const noCode = await page.request.delete(`/api/auth/passkey/${id}`, {
          headers: csrf,
          data: { code: "000000" },
        });
        expect(noCode.status()).toBe(400);
        const removed = await page.request.delete(`/api/auth/passkey/${id}`, {
          headers: csrf,
          data: { code: totpGenerate(secret) },
        });
        expect(removed.ok()).toBe(true);

        await context.clearCookies();
        await signInWithPassword(page);
        await page.waitForURL((url) => url.pathname === "/auth/mfa", { timeout: 20_000 });
        await expect(page.locator('input[name="code"]')).toBeVisible(STEP);
        await expect(page.getByTestId("passkey-sign-in")).toHaveCount(0);
      });
    } finally {
      await context.close();
    }
  } finally {
    if (enabled) {
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
