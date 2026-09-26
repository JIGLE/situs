import { test, expect } from "@playwright/test";
import en from "../messages/en.json";
import pt from "../messages/pt.json";
import { revealPortfolioLink } from "./helpers/nav";
import { settle } from "./helpers/wait";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * These tests used to wrap every navigation in `if (await link.isVisible())`, so an absent
 * element skipped the assertion instead of failing it — a nav that stopped rendering passed.
 * The guards are gone: each test now asserts the link exists and that clicking it changes the
 * URL, which is the thing a navigation test is actually for.
 *
 * A single `getByRole("link", …)` is correct at both viewports. The desktop sidebar is wrapped in
 * `hidden md:flex` and the mobile bottom bar in its own breakpoint, so exactly one of them is in
 * the accessibility tree at a time. That only became true once the sidebar stopped putting
 * `role="listitem"` on its anchors, which had been suppressing the link role entirely — which is
 * also why the original "reach it through the bottom nav below md" plan was unnecessary.
 */
test.describe("Dashboard", () => {
  test("should display the main dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await settle(page);

    await expect(page).toHaveURL((url) => url.pathname === "/dashboard");
    // The app shell must actually render — not merely "some text on the page".
    await expect(page.getByRole("navigation").first()).toBeVisible();
  });

  test("should navigate to Portfolio section", async ({ page }) => {
    await page.goto("/dashboard");
    await settle(page);

    await revealPortfolioLink(page);
    const portfolioLink = page.getByRole("link", { name: /portfolio/i }).first();
    await expect(portfolioLink).toBeVisible();
    await portfolioLink.click();

    // Assert the destination, not the word that matched the link.
    await expect(page).toHaveURL((url) => url.pathname === "/portfolio");
  });

  // Leases was hidden from both layouts, so the screen where leases are created had no way in.
  test("should navigate to Leases section", async ({ page }) => {
    await page.goto("/dashboard");
    await settle(page);

    const leasesLink = page.getByRole("link", { name: "Leases", exact: true }).first();
    await expect(leasesLink).toBeVisible();
    await leasesLink.click();

    await expect(page).toHaveURL((url) => url.pathname === "/leases");
  });

  test("should navigate to People section", async ({ page }) => {
    await page.goto("/dashboard");
    await settle(page);

    const peopleLink = page.getByRole("link", { name: /people/i }).first();
    await expect(peopleLink).toBeVisible();
    await peopleLink.click();

    await expect(page).toHaveURL((url) => url.pathname === "/people");
  });

  test("should switch language from Settings › Appearance", async ({ page }) => {
    // `LanguageSelector` is not in the desktop shell (only the phone's More sheet and the auth
    // pages have it), so on a computer this select is where the language changes.
    await page.goto("/settings?tab=appearance");
    await settle(page);

    // Named by its label, so the field is found in either language. It used to be found by a
    // `div:has(> label)` locator, and the test only checked that the select showed Português:
    // the select saved the account's copy and the screen stayed in English, and the test passed.
    const english = page.getByRole("combobox", { name: en.settings.panel.language });
    await expect(english).toContainText("English");

    await english.click();
    await page.getByRole("option", { name: "Português" }).click();

    // The page itself switches, with no Guardar and on the same section.
    await expect(page.locator("html")).toHaveAttribute("lang", "pt");
    const portuguese = page.getByRole("combobox", { name: pt.settings.panel.language });
    await expect(portuguese).toContainText("Português");

    // Back to English: every test shares this account, and the others read English.
    await portuguese.click();
    await page.getByRole("option", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(english).toContainText("English");
  });
});
