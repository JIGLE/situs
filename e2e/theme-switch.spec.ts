import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * The theme a device chose is drawn by the server, and a signed-out person can change it.
 *
 * Two things were wrong on the owner's phone: nothing on the sign-in page could change the theme
 * (Settings is behind the sign-in, and the provider was not even mounted there), and the page's
 * colour depended on an inline script alone. Each test here is one way that failed.
 */
const DARK = "#0b110d";
const LIGHT = "#f6f0e4";

const base = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const setCookie = (context: BrowserContext, value: string) =>
  context.addCookies([{ name: "situs-mode", value, url: base }]);

const themeColors = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((tag) =>
      tag.getAttribute("content"),
    ),
  );

test.describe("the theme the server draws", () => {
  test.use({ colorScheme: "light" });

  test("is light from the first byte for a device that chose light, with no script", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: "light" });
    await setCookie(context, "normal");
    const page = await context.newPage();
    await page.goto("/auth/signin");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-mode", "normal");
    await expect(html).toHaveClass(/\blight\b/);
    expect(await themeColors(page)).toEqual([LIGHT]);
    await context.close();
  });

  test("is dark from the first byte for a device that chose dark, or never chose", async ({
    browser,
  }) => {
    for (const cookie of ["dark", null]) {
      const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: "light" });
      if (cookie) await setCookie(context, cookie);
      const page = await context.newPage();
      await page.goto("/auth/signin");

      await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
      await context.close();
    }
  });

  for (const [label, setup, expectedMode, expectedColor] of [
    ["a light cookie", "cookie:normal", "normal", LIGHT],
    ["a dark cookie", "cookie:dark", "dark", DARK],
    ["following the phone, on a light phone", "cookie:system", "normal", LIGHT],
    ["no cookie, never chose", "none", "dark", DARK],
    ["a choice stored before cookies existed", "storage:normal", "normal", LIGHT],
  ] as const) {
    test(`keeps exactly one status-bar tag after hydration: ${label}`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: "light" });
      if (setup.startsWith("cookie:")) await setCookie(context, setup.slice(7));
      const page = await context.newPage();
      if (setup.startsWith("storage:")) {
        await page.addInitScript(
          (value) => localStorage.setItem("situs-mode", value),
          setup.slice(8),
        );
      }
      await page.goto("/auth/signin");
      await expect(page.locator("h1")).toBeVisible();
      await page.waitForTimeout(500);

      await expect(page.locator("html")).toHaveAttribute("data-mode", expectedMode);
      expect(await themeColors(page), "one tag, in the colour of the page").toEqual([
        expectedColor,
      ]);
      await context.close();
    });
  }

  test("brings a choice stored before cookies existed into the cookie", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("situs-mode", "normal"));
    await page.goto("/auth/signin");

    const cookie = (await context.cookies()).find((c) => c.name === "situs-mode");
    expect(cookie?.value).toBe("normal");
    await context.close();
  });
});

test.describe("the sign-in page has a theme control", () => {
  test.use({ colorScheme: "light" });

  test("a signed-out person can choose Light, and the next visit is drawn light by the server", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/auth/signin");
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");

    await page.getByRole("button", { name: /theme|tema/i }).click();
    await page.getByRole("menuitem", { name: /^(light|claro)$/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "normal");
    expect(await themeColors(page)).toEqual([LIGHT]);

    // The next page is drawn light by the server: look at it with scripts off.
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "situs-mode")?.value).toBe("normal");
    const plain = await browser.newContext({ javaScriptEnabled: false, colorScheme: "light" });
    await plain.addCookies(cookies);
    const bare = await plain.newPage();
    await bare.goto("/auth/signin");
    await expect(bare.locator("html")).toHaveAttribute("data-mode", "normal");

    // And back to Dark.
    await page.getByRole("button", { name: /theme|tema/i }).click();
    await page.getByRole("menuitem", { name: /^(dark|escuro)$/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    expect(await themeColors(page)).toEqual([DARK]);

    await plain.close();
    await context.close();
  });

  test("follows the phone on System", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/auth/signin");

    await page.getByRole("button", { name: /theme|tema/i }).click();
    await page.getByRole("menuitem", { name: /^(system|sistema)$/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "normal");

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    await context.close();
  });
});
