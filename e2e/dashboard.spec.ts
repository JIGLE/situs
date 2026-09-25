import { test, expect } from "@playwright/test";
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

    // On a phone Portfolio sits under "More": Leases holds its place in the bottom bar. Decided by
    // the viewport, not by whether the link happens to be visible, so a missing link still fails.
    if ((page.viewportSize()?.width ?? 1280) < 768) {
      await page.getByRole("button", { name: /^more$/i }).click();
    }
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
    // This used to look for a language switcher on the dashboard with
    // `/language|idioma|en|pt/i`, which was broad enough to match several controls and failed
    // with a strict mode violation. It could not have worked regardless: `LanguageSelector` is
    // not rendered anywhere in the authenticated desktop shell — only in the mobile "More" sheet
    // (components/ui/mobile-nav.tsx:194) and the auth pages. On desktop the
    // control lives in Settings › Appearance, so test it where it actually is.
    await page.goto("/settings?tab=appearance");
    await settle(page);

    // Anchor on the field, not on its current value: a locator filtered by `/english/i` stops
    // matching the moment the test changes it, and the assertion then waits on nothing.
    const languageField = page.locator('div:has(> label:text-is("Language"))').last();
    const languageSelect = languageField.getByRole("combobox").first();
    await expect(languageSelect).toBeVisible();
    await expect(languageSelect).toContainText(/english/i);

    await languageSelect.click();
    await page.getByRole("option", { name: /portugu/i }).click();

    // The setting persists rather than navigating, so assert the control took the value.
    await expect(languageSelect).toContainText(/portugu/i);
  });
});
