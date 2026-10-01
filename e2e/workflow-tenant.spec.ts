import { test, expect } from "@playwright/test";

test.use({ storageState: "playwright/.auth/user.json" });

test.describe("Critical Path: Tenant management", () => {
  let seededPropertyId: string;

  // Seed a property via API so the tenant form has something to link to
  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/properties", {
      data: {
        name: `Seed Property ${Date.now()}`,
        address: "1 Seed Street, Lisbon",
        type: "apartment",
        bedrooms: 2,
        bathrooms: 1,
        rent: 1000,
      },
    });
    if (res.ok()) {
      const body = await res.json();
      seededPropertyId = body.id ?? body.data?.id;
    }
  });

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

    // Fill required fields. Only Full Name and Email are visible on the create form — phone,
    // property, rent and the lease dates sit behind a progressive-disclosure section
    // (`showMore` in components/features/tenant/tenants-view.tsx:80,139), collapsed unless the
    // dialog is editing an existing tenant. Open it before reaching for those fields.
    await page.getByLabel("Full Name").fill(tenantName);
    await page.getByLabel("Email").fill(tenantEmail);
    await dialog.getByRole("button", { name: /add lease & contact details/i }).click();
    await expect(page.getByLabel("Phone")).toBeVisible();
    await page.getByLabel("Phone").fill("+351 912 345 678");

    // Lease dates
    const today = new Date();
    const startDate = today.toISOString().split("T")[0];
    const endDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
      .toISOString()
      .split("T")[0];
    await page.getByLabel("Lease Start").fill(startDate);
    await page.getByLabel("Lease End").fill(endDate);

    // Rent
    const rentField = page.getByLabel(/monthly rent|rent/i).first();
    await rentField.fill("900");

    // Link to seeded property if the selector is present
    if (seededPropertyId) {
      const propertySelect = dialog
        .locator("div.space-y-2")
        .filter({ hasText: /property/i })
        .getByRole("combobox");
      if (await propertySelect.isVisible()) {
        await propertySelect.click();
        const option = page.getByRole("option").first();
        await expect(option).toBeVisible({ timeout: 3000 });
        await option.click();
      }
    }

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
