import { test, expect } from "@playwright/test";
import { settle } from "./helpers/wait";

/**
 * Phase 2 – Optimistic Delete & UI Feedback Tests
 *
 * The navigation in these tests used to be wrapped in `if (await navLink.isVisible())`. The final
 * assertion still ran, so they passed — but against `/en`, never the page in the title. "portfolio
 * page loads without rendering errors" never visited the portfolio page. Navigation is asserted
 * now, and the URL is checked, so each test measures the surface it names.
 *
 * Validates that delete operations show proper confirmation,
 * the UI updates immediately (optimistic), and error states
 * are handled gracefully.
 */

test.describe("Optimistic Delete – API Level", () => {
  test("DELETE non-existent property returns 404 or auth error", async ({ request }) => {
    const res = await request.delete("/api/properties/does-not-exist-123");
    // Without auth: 401/403. With auth but missing: 404
    expect([401, 403, 404]).toContain(res.status());
  });

  test("DELETE non-existent tenant returns 404 or auth error", async ({ request }) => {
    const res = await request.delete("/api/tenants/does-not-exist-123");
    expect([401, 403, 404]).toContain(res.status());
  });

  test("DELETE non-existent lease returns 404 or auth error", async ({ request }) => {
    const res = await request.delete("/api/leases/does-not-exist-123");
    expect([401, 403, 404]).toContain(res.status());
  });

  test("DELETE non-existent receipt returns 404 or auth error", async ({ request }) => {
    const res = await request.delete("/api/receipts/does-not-exist-123");
    expect([401, 403, 404]).toContain(res.status());
  });
});

test.describe("No Native confirm() Calls", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  test("no native confirm() dialogs appear in properties view", async ({ page }) => {
    let nativeDialogAppeared = false;
    page.on("dialog", (dialog) => {
      nativeDialogAppeared = true;
      dialog.dismiss();
    });

    await page.goto("/dashboard");
    await settle(page);

    const navLink = page.getByRole("link", { name: /portfolio/i }).first();
    await expect(navLink).toBeVisible();
    await navLink.click();
    await expect(page).toHaveURL((url) => url.pathname === "/portfolio");
    await settle(page);

    // Native confirm() should NEVER appear – we use AlertDialog. (Portfolio has no delete
    // affordance of its own; the destructive path is covered by crud-confirmation-dialogs.)
    expect(nativeDialogAppeared).toBe(false);
  });

  test("no native confirm() dialogs appear in people view", async ({ page }) => {
    let nativeDialogAppeared = false;
    page.on("dialog", (dialog) => {
      nativeDialogAppeared = true;
      dialog.dismiss();
    });

    await page.goto("/dashboard");
    await settle(page);

    const navLink = page.getByRole("link", { name: /people/i }).first();
    await expect(navLink).toBeVisible();
    await navLink.click();
    await expect(page).toHaveURL((url) => url.pathname === "/people");
    await settle(page);

    // Actually trigger the destructive path, which is what makes this assertion mean anything:
    // deletion lives behind a per-row "<Name> options" menu.
    const rowMenu = page.getByRole("button", { name: /options$/i }).first();
    await expect(rowMenu).toBeVisible();
    await rowMenu.click();
    await page.getByRole("menuitem", { name: /delete/i }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 5000 });

    expect(nativeDialogAppeared).toBe(false);
  });
});

test.describe("Page Skeletons", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  test("dashboard loads without rendering errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/dashboard");
    await settle(page);

    // Page should load successfully
    const title = await page.title();
    expect(title).toBeTruthy();

    // No JS errors
    expect(errors).toHaveLength(0);
  });

  test("portfolio page loads without rendering errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/dashboard");
    await settle(page);

    const navLink = page.getByRole("link", { name: /portfolio/i }).first();
    await expect(navLink).toBeVisible();
    await navLink.click();
    await expect(page).toHaveURL((url) => url.pathname === "/portfolio");
    await settle(page);

    expect(errors).toHaveLength(0);
  });

  test("people page loads without rendering errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/dashboard");
    await settle(page);

    const navLink = page.getByRole("link", { name: /people/i }).first();
    await expect(navLink).toBeVisible();
    await navLink.click();
    await expect(page).toHaveURL((url) => url.pathname === "/people");
    await settle(page);

    expect(errors).toHaveLength(0);
  });
});
