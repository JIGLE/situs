import { test, expect, type Locator } from "@playwright/test";

test.use({ storageState: "playwright/.auth/user.json" });

test.describe("Critical Path: Lease management", () => {
  let propertyId: string;
  let tenantId: string;

  // Seed both a property and a tenant via API so the lease form has real options to select
  test.beforeAll(async ({ request }) => {
    const today = new Date();
    const nextYear = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());

    const propRes = await request.post("/api/properties", {
      data: {
        name: `Lease Seed Property ${Date.now()}`,
        address: "42 Lease Ave, Lisbon",
        type: "apartment",
        bedrooms: 2,
        bathrooms: 1,
        rent: 1200,
      },
    });
    if (propRes.ok()) {
      const body = await propRes.json();
      propertyId = body.id ?? body.data?.id;
    }

    const tenantRes = await request.post("/api/tenants", {
      data: {
        name: `Lease Seed Tenant ${Date.now()}`,
        email: `lease_seed_${Date.now()}@test.local`,
        phone: "+351 900 000 001",
        rent: 1200,
        leaseStart: today.toISOString(),
        leaseEnd: nextYear.toISOString(),
      },
    });
    if (tenantRes.ok()) {
      const body = await tenantRes.json();
      tenantId = body.id ?? body.data?.id;
    }
  });

  /**
   * A tenancy is one sheet: property, tenant (typed in, or chosen from the list), rent and term,
   * with the contract details behind a fold. The property and tenant pickers are Radix `Select`s,
   * whose triggers expose role=combobox; the property's is the first in the sheet.
   */
  const openSheet = async (page: import("@playwright/test").Page) => {
    await page.goto("/portfolio?tab=leases");
    await expect(page).toHaveURL(/tab=leases/);
    await page
      .getByRole("button", { name: /new tenancy/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    return dialog;
  };

  const pickOption = async (
    page: import("@playwright/test").Page,
    combo: Locator,
    name?: RegExp,
  ) => {
    await combo.click();
    const option = name ? page.getByRole("option", { name }) : page.getByRole("option").first();
    await expect(option.first()).toBeVisible();
    await option.first().click();
  };

  test("should create a tenant and their lease from one sheet", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("Browser error:", msg.text());
    });

    const dialog = await openSheet(page);
    await pickOption(page, dialog.getByRole("combobox").first());
    await dialog.getByPlaceholder(/full name/i).fill(`Sheet Tenant ${Date.now()}`);
    await dialog.getByLabel(/monthly rent/i).fill("1200");

    const tenantPost = page.waitForResponse(
      (res) => res.url().includes("/api/tenants") && res.request().method() === "POST",
    );
    const leasePost = page.waitForResponse(
      (res) => res.url().includes("/api/leases") && res.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: /create tenancy/i }).click();

    expect([200, 201]).toContain((await tenantPost).status());
    expect([200, 201]).toContain((await leasePost).status());
    await expect(dialog).toBeHidden({ timeout: 10000 });
  });

  test("should start a lease for a tenant already on file", async ({ page }) => {
    test.skip(!tenantId, "the seed tenant was not created");
    const dialog = await openSheet(page);
    await pickOption(page, dialog.getByRole("combobox").first());
    await dialog.getByRole("button", { name: /choose an existing tenant/i }).click();
    await pickOption(page, dialog.getByRole("combobox").nth(1), /lease seed tenant/i);
    await dialog.getByLabel(/monthly rent/i).fill("1200");

    const leasePost = page.waitForResponse(
      (res) => res.url().includes("/api/leases") && res.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: /create tenancy/i }).click();
    expect([200, 201]).toContain((await leasePost).status());
    await expect(dialog).toBeHidden({ timeout: 10000 });
  });

  test("should say what is missing and save nothing", async ({ page }) => {
    const dialog = await openSheet(page);
    await dialog.getByRole("button", { name: /create tenancy/i }).click();

    await expect(dialog.getByText("Choose a property.")).toBeVisible();
    await expect(dialog.getByText("Enter the tenant's name.")).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("should close the sheet without creating a lease", async ({ page }) => {
    const dialog = await openSheet(page);
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 5000 });
  });
});
