import { test, expect } from "@playwright/test";

// ─── Lease Template Generation ────────────────────────────────────────────────

test.describe("Compliance: Lease Template Generation", () => {
  test("POST /api/leases/generate-template requires authentication", async ({ request }) => {
    const response = await request.post("/api/leases/generate-template", {
      data: {
        landlordName: "João Silva",
        landlordNif: "123456789",
        landlordAddress: "Rua A, Lisboa",
        tenantName: "Maria Santos",
        tenantNif: "987654321",
        tenantAddress: "Rua B, Porto",
        propertyAddress: "Rua C, n.º 1, Lisboa",
        startDate: "2026-04-01",
        endDate: "2027-03-31",
        monthlyRent: 900,
        deposit: 1800,
        autoRenew: true,
      },
    });
    expect([401, 403, 302].includes(response.status())).toBeTruthy();
  });

  test("POST /api/leases/generate-template endpoint exists (not 404)", async ({ request }) => {
    const response = await request.post("/api/leases/generate-template", {
      data: {},
    });
    expect(response.status()).not.toBe(404);
  });
});

// ─── Notification Cron ────────────────────────────────────────────────────────

test.describe("Compliance: Notification Cron", () => {
  test("POST /api/cron/notifications rejects missing auth", async ({ request }) => {
    const response = await request.post("/api/cron/notifications");
    expect([401, 503].includes(response.status())).toBeTruthy();
  });

  test("POST /api/cron/notifications rejects wrong token", async ({ request }) => {
    const response = await request.post("/api/cron/notifications", {
      headers: { Authorization: "Bearer wrong-token-12345" },
    });
    // Either 401 unauthorized or 503 if CRON_SECRET not configured in test env
    expect([401, 503].includes(response.status())).toBeTruthy();
  });

  test("POST /api/cron/notifications endpoint exists (not 404)", async ({ request }) => {
    const response = await request.post("/api/cron/notifications");
    expect(response.status()).not.toBe(404);
  });
});
