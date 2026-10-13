import { test, expect } from "@playwright/test";
import { settle } from "./helpers/wait";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * Every main screen has exactly one heading, whatever is in the account.
 *
 * `PageHeader` writes it, and the mobile top bar is a paragraph, not a second `h1`. The dashboard
 * of an account with nothing set up returns early, before the page it draws once there is data, so
 * a page that only had its heading in the full view would pass a read of the source and fail here.
 * Counted by role, so a heading that is only read by a screen reader counts and a hidden one does
 * not.
 */
const SCREENS = [
  "/dashboard",
  "/portfolio",
  "/leases",
  "/financials",
  "/people",
  "/settings",
  "/admin",
];

for (const path of SCREENS) {
  test(`${path} has exactly one heading`, async ({ page }) => {
    await page.goto(path);
    await settle(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
}
