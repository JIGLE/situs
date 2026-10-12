import { test, expect } from "@playwright/test";

/**
 * A visitor with no saved language gets one language, everywhere.
 *
 * The proxy resolved it from the cookie and then the browser's `Accept-Language`; the root layout and
 * the sign-in page from the cookie alone. An English browser therefore got an English app, a Portuguese
 * sign-in page, and a privacy notice in Portuguese under `lang="en"` and an EN language control.
 * Nothing is saved on the context, so the browser's own language is all there is to go by.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const CASES = [
  {
    locale: "en-US",
    lang: "en",
    control: "EN",
    privacy: "Privacy Policy",
    signIn: /Sign in to Situs/i,
  },
  {
    locale: "pt-PT",
    lang: "pt",
    control: "PT",
    privacy: "Política de Privacidade",
    signIn: /Entrar no Situs/i,
  },
];

for (const { locale, lang, control, privacy, signIn } of CASES) {
  test.describe(`a browser that asks for ${locale}`, () => {
    test.use({ locale });

    test("the privacy notice, its language control and <html lang> agree", async ({ page }) => {
      await page.goto("/privacy", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(privacy);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.getByRole("button", { name: control, exact: true })).toBeVisible();
    });

    test("the sign-in page speaks the same language", async ({ page }) => {
      await page.goto("/auth/signin", { waitUntil: "networkidle" });
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(signIn);
    });
  });
}

test("a saved choice still wins over the browser", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    locale: "en-US",
    baseURL: baseURL ?? undefined,
    storageState: { cookies: [], origins: [] },
  });
  await context.addCookies([
    { name: "situs-locale", value: "it", url: baseURL ?? "http://localhost:3000" },
  ]);
  const page = await context.newPage();
  await page.goto("/privacy", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await context.close();
});
