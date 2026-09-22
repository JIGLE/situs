import { test, expect } from "@playwright/test";

// ─── Rent Receipts (Portugal) ────────────────────────────────────────────────

test.describe("Compliance: Rent Receipts (PT)", () => {
  test("GET /api/compliance/rent-receipts requires authentication", async ({ request }) => {
    const response = await request.get("/api/compliance/rent-receipts");
    expect([401, 403, 302].includes(response.status())).toBeTruthy();
  });

  test("POST /api/compliance/rent-receipts requires authentication", async ({ request }) => {
    const response = await request.post("/api/compliance/rent-receipts", {
      data: {
        leaseId: "lease_123",
        landlordNif: "123456789",
        tenantNif: "987654321",
        rentAmount: 800,
        paymentDate: "2026-03-01",
        rentalPeriodStart: "2026-03-01",
        rentalPeriodEnd: "2026-03-31",
      },
    });
    expect([401, 403, 302].includes(response.status())).toBeTruthy();
  });

  test("GET /api/compliance/rent-receipts endpoint exists (not 404)", async ({ request }) => {
    const response = await request.get("/api/compliance/rent-receipts");
    expect(response.status()).not.toBe(404);
  });
});

// ─── NRUA Registration (Spain) ───────────────────────────────────────────────

test.describe("Compliance: NRUA Registration (ES)", () => {
  test("GET /api/compliance/nrua requires authentication", async ({ request }) => {
    const response = await request.get("/api/compliance/nrua");
    expect([401, 403, 302].includes(response.status())).toBeTruthy();
  });

  test("POST /api/compliance/nrua requires authentication", async ({ request }) => {
    const response = await request.post("/api/compliance/nrua", {
      data: {
        leaseId: "lease_123",
        landlordNif: "12345678Z",
        tenantNif: "X1234567L",
        cadasterReference: "1234567AB1234A0001JJ",
        municipalityCode: "28079",
        contractType: "primary_residence",
      },
    });
    expect([401, 403, 302].includes(response.status())).toBeTruthy();
  });

  test("GET /api/compliance/nrua endpoint exists (not 404)", async ({ request }) => {
    const response = await request.get("/api/compliance/nrua");
    expect(response.status()).not.toBe(404);
  });
});

// ─── Ley de Vivienda Rent Cap ─────────────────────────────────────────────────

test.describe("Compliance: Rent Cap Validation (ES)", () => {
  test("POST /api/compliance/rent-cap requires authentication", async ({ request }) => {
    const response = await request.post("/api/compliance/rent-cap", {
      data: {
        propertyId: "prop_123",
        proposedRent: 1200,
        priorContractRent: 1000,
        isZonaTensionada: true,
        landlordTotalUnits: 6,
        stressedZoneUnits: 5,
      },
    });
    expect([401, 403, 302].includes(response.status())).toBeTruthy();
  });

  test("POST /api/compliance/rent-cap endpoint exists (not 404)", async ({ request }) => {
    const response = await request.post("/api/compliance/rent-cap", {
      data: {},
    });
    expect(response.status()).not.toBe(404);
  });
});

// ─── Lease Template Generation ────────────────────────────────────────────────

test.describe("Compliance: Lease Template Generation", () => {
  test("POST /api/leases/generate-template requires authentication", async ({ request }) => {
    const response = await request.post("/api/leases/generate-template", {
      data: {
        country: "PT",
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
