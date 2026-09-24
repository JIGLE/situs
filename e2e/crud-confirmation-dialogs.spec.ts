import { test, expect } from "@playwright/test";
import { settle } from "./helpers/wait";

/**
 * Phase 2 CRUD Integrity Tests
 *
 * Validates the confirmation dialog system, optimistic deletes,
 * and form validation that replaced native confirm() calls.
 */

test.describe("API CRUD Endpoints – Auth Guard", () => {
  test("DELETE /api/properties/:id requires auth", async ({ request }) => {
    const res = await request.delete("/api/properties/nonexistent-id");
    expect([401, 403, 302]).toContain(res.status());
  });

  test("DELETE /api/tenants/:id requires auth", async ({ request }) => {
    const res = await request.delete("/api/tenants/nonexistent-id");
    expect([401, 403, 302]).toContain(res.status());
  });

  test("DELETE /api/leases/:id requires auth", async ({ request }) => {
    const res = await request.delete("/api/leases/nonexistent-id");
    expect([401, 403, 302]).toContain(res.status());
  });

  test("DELETE /api/receipts/:id requires auth", async ({ request }) => {
    const res = await request.delete("/api/receipts/nonexistent-id");
    expect([401, 403, 302]).toContain(res.status());
  });

  test("POST /api/properties validates body", async ({ request }) => {
    // Empty body should fail validation or auth
    const res = await request.post("/api/properties", { data: {} });
    expect([400, 401, 403, 422]).toContain(res.status());
  });

  test("POST /api/tenants validates body", async ({ request }) => {
    const res = await request.post("/api/tenants", { data: {} });
    expect([400, 401, 403, 422]).toContain(res.status());
  });
});

test.describe("Confirmation Dialog UI – Unauthenticated", () => {
  test("sign-in page renders without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/auth/signin");
    await settle(page);

    // No uncaught JS errors
    expect(errors).toHaveLength(0);
  });
});

test.describe("Confirmation Dialog UI – Authenticated", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  /**
   * These tests used to call `test.skip(true, …)` on themselves whenever a nav link or a delete
   * button was not visible — which, before the suite could authenticate at all, was always. They
   * reported as skipped rather than failed, so they were honest, but they never ran once.
   *
   * Deletion is reached from a per-row menu ("<Name> options"), not a bare Delete button, and the
   * confirmation is an `alertdialog`.
   *
   * NOTE: there is no property-delete test here because there is no property-delete UI. The route
   * exists and is auth-guarded (see above), but `deleteProperty` is not wired to any component.
   * The old test asserted against an affordance that does not exist, which is the other half of
   * why it could only ever skip.
   */
  const openTenantDeleteConfirmation = async (page: import("@playwright/test").Page) => {
    await page.goto("/people");
    await settle(page);

    const rowMenu = page.getByRole("button", { name: /options$/i }).first();
    await expect(rowMenu).toBeVisible();
    await rowMenu.click();

    const deleteItem = page.getByRole("menuitem", { name: /delete/i });
    await expect(deleteItem).toBeVisible();
    await deleteItem.click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    return dialog;
  };

  test("tenant delete opens a confirmation dialog with destructive copy", async ({ page }) => {
    const dialog = await openTenantDeleteConfirmation(page);

    await expect(dialog).toContainText(/permanently removed|cannot be undone/i);
    await expect(dialog.getByRole("button", { name: /cancel/i })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^delete$/i })).toBeVisible();
  });

  test("confirmation dialog carries the glass-modal treatment", async ({ page }) => {
    const dialog = await openTenantDeleteConfirmation(page);

    // `glass-modal` sits on AlertDialogContent itself (components/ui/alert-dialog.tsx:67). The
    // old test looked for it as a *descendant* of the dialog, so it matched nothing even when the
    // styling was correctly applied.
    await expect(dialog).toHaveClass(/glass-modal/);
  });

  test("cancelling the confirmation leaves the tenant in place", async ({ page }) => {
    await page.goto("/people");
    await settle(page);

    const firstRowMenu = page.getByRole("button", { name: /options$/i }).first();
    await expect(firstRowMenu).toBeVisible();
    // The menu is labelled "<Tenant name> options" — recover the name so we can assert the row
    // survives, which is the behaviour that actually matters about a cancel.
    const label = (await firstRowMenu.getAttribute("aria-label")) ?? "";
    const tenantName = label.replace(/\s*options$/i, "").trim();
    expect(tenantName.length).toBeGreaterThan(0);

    await firstRowMenu.click();
    await page.getByRole("menuitem", { name: /delete/i }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await dialog.getByRole("button", { name: /cancel/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(tenantName).first()).toBeVisible();
  });
});

test.describe("Form Validation – Authenticated", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  test("property form reports a required field once it is cleared", async ({ page }) => {
    await page.goto("/portfolio?view=properties");
    await settle(page);

    // Create is a "New asset" dropdown → "New property" item; see workflow-property.spec.ts.
    await page
      .getByRole("button", { name: /new asset/i })
      .first()
      .click();
    await page.getByRole("menuitem", { name: /new property/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The old test filled, cleared, waited, then only `console.log`ed whether an error appeared —
    // it asserted nothing at all. Submitting with the name cleared must surface a message.
    const nameInput = page.getByLabel("Property Name");
    await nameInput.fill("Temporary");
    await nameInput.clear();
    await dialog.getByRole("button", { name: /^create$/i }).click();

    await expect(dialog.locator(".text-destructive, [role='alert']").first()).toBeVisible({
      timeout: 5000,
    });
  });
});
