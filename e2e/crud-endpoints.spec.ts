import { test, expect } from "@playwright/test";

test.describe("Lease Management", () => {
  test("leases list should require authentication", async ({ request }) => {
    const response = await request.get("/api/leases");

    // Should require authentication
    expect([401, 403, 302].includes(response.status())).toBeTruthy();
  });
});

test.describe("Property Management", () => {
  test("properties list should require authentication", async ({ request }) => {
    const response = await request.get("/api/properties");

    // Should require authentication
    expect([401, 403, 302].includes(response.status())).toBeTruthy();
  });
});

test.describe("Tenant Management", () => {
  test("tenants list should require authentication", async ({ request }) => {
    const response = await request.get("/api/tenants");

    // Should require authentication
    expect([401, 403, 302].includes(response.status())).toBeTruthy();
  });
});
