import type { Page } from "@playwright/test";

/**
 * On a phone, Portfolio sits under "More": Leases holds its place in the bottom bar. Call this
 * before looking for the Portfolio link. It is decided by the viewport, not by whether the link
 * happens to be visible, so a missing link still fails the test that looks for it.
 */
export async function revealPortfolioLink(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole("button", { name: /^more$/i }).click();
  }
}
