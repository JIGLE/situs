import { test, expect, type Page } from "@playwright/test";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * Open the create-property dialog.
 *
 * There is no "Add Property" button any more. The Portfolio tree rebrand replaced it with a
 * "New asset" dropdown whose first item is "New property"
 * (components/features/assets/assets-view.tsx:295-301) — the in-view `DialogTrigger` that used to
 * carry the label still exists but is `className="hidden"`, so it can never be clicked.
 */
async function openCreatePropertyDialog(page: Page) {
  await page
    .getByRole("button", { name: /new asset/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: /new property/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Critical Path: Property management", () => {
  test("should create a new property and show it in the list", async ({ page }) => {
    const timestamp = Date.now();
    const propertyName = `Test Property ${timestamp}`;

    // Attach listeners before any navigation
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("Browser error:", msg.text());
    });

    await page.goto("/portfolio?view=properties");
    await expect(page).toHaveURL(/\/portfolio/);

    const dialog = await openCreatePropertyDialog(page);

    // Fill form. "Full Address Search" is now just "Address", with Country / Postal code / City
    // as separate inputs beneath it. Postal code is format-validated ("Invalid postal code
    // format") so it cannot be skipped. Bedrooms and bathrooms moved behind an "Add details"
    // disclosure and are not required to create a property, so they are left out.
    await page.getByLabel("Property Name").fill(propertyName);
    await page.getByLabel(/^address/i).fill("123 Test St");
    await page.getByLabel("Postal code").fill("1000-001");
    await page.getByLabel("City").fill("Lisbon");
    await page.getByLabel(/monthly rent/i).fill("1500");

    // Submit and wait for the API call to complete
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/properties") && res.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: /^create$/i }).click();

    const response = await responsePromise;
    expect(response.status()).toBe(201);

    // Dialog closes on success; new property name appears in the list
    await expect(dialog).toBeHidden({ timeout: 5000 });
    await expect(page.getByText(propertyName, { exact: false })).toBeVisible();
  });

  test("should show validation errors when required fields are missing", async ({ page }) => {
    await page.goto("/portfolio?view=properties");
    const dialog = await openCreatePropertyDialog(page);

    // Submit without filling anything. Unlike the tenant form, none of these inputs carry the
    // native `required` attribute, so submission reaches the schema and renders real messages.
    await dialog.getByRole("button", { name: /^create$/i }).click();

    // Form should stay open with validation feedback
    await expect(dialog).toBeVisible();
    // At least one validation message should be present
    const errors = dialog.locator("[role='alert'], .text-destructive, .text-red-400");
    await expect(errors.first()).toBeVisible({ timeout: 3000 });
  });

  test("should cancel the dialog without creating a property", async ({ page }) => {
    await page.goto("/portfolio?view=properties");
    const dialog = await openCreatePropertyDialog(page);

    await page.getByLabel("Property Name").fill("Should not be created");

    const cancelButton = dialog.getByRole("button", { name: /cancel/i });
    await cancelButton.click();

    await expect(dialog).toBeHidden({ timeout: 3000 });
  });
});
