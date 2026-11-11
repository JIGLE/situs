import { test, expect } from "@playwright/test";

test.use({ storageState: "playwright/.auth/user.json" });

test.describe("Critical Path: Tenant management", () => {
  test("should create a new tenant and show them in the list", async ({ page }) => {
    const timestamp = Date.now();
    const tenantName = `Test Tenant ${timestamp}`;
    const tenantEmail = `tenant${timestamp}@test.local`;

    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("Browser error:", msg.text());
    });

    await page.goto("/people");
    await expect(page).toHaveURL(/\/people/);

    // Open Add Tenant dialog
    await page.getByRole("button", { name: "Add Tenant" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Name and email, then the phone behind the fold. The form asks for no property, rent or
    // lease dates: a tenant reads those from their lease, which is created on its own.
    await page.getByLabel("Full Name").fill(tenantName);
    await page.getByLabel("Email").fill(tenantEmail);
    await dialog.getByRole("button", { name: /add phone and notes/i }).click();
    await expect(page.getByLabel("Phone")).toBeVisible();
    await page.getByLabel("Phone").fill("+351 912 345 678");
    await expect(dialog.getByLabel("Lease Start")).toHaveCount(0);

    // Submit and await API response
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/tenants") && res.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: /add tenant|create/i }).click();
    const response = await responsePromise;

    expect([200, 201]).toContain(response.status());
    await expect(dialog).toBeHidden({ timeout: 5000 });
    await expect(page.getByText(tenantEmail)).toBeVisible({ timeout: 5000 });
  });

  test("should show validation errors for missing required fields", async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Add Tenant" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Submit empty form
    await dialog.getByRole("button", { name: /add tenant|create/i }).click();

    // This form validates natively: Name carries `required` (the email is optional), so the browser
    // blocks submission and `dialog.handleSubmit` never runs — which means no React `formErrors` are
    // set and no `.text-destructive` element is ever rendered. The old assertion looked for that
    // element and could only ever fail. Assert the behaviour that actually exists: the dialog
    // stays open, and the first required field reports itself invalid.
    await expect(dialog).toBeVisible();
    const nameInput = page.getByLabel("Full Name");
    await expect(nameInput).toHaveJSProperty("validity.valid", false);
    await expect(nameInput).toHaveJSProperty("validity.valueMissing", true);
  });

  test("should close dialog when cancel is clicked", async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Add Tenant" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: /cancel/i }).click();
    await expect(dialog).toBeHidden({ timeout: 3000 });
  });
});
