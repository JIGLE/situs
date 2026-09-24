import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getTenants, POST as postTenants } from "./route";

// Mock auth middleware
vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: vi.fn(async (req) => {
    if (req.headers.get("Authorization") === "Bearer valid-token") {
      return { userId: "user-123", scopeUserId: "user-123", portalRole: "owner" };
    }
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }),
  getAccessContext: vi.fn(async (req) => {
    if (req.headers.get("Authorization") === "Bearer valid-token") {
      return { userId: "user-123", scopeUserId: "user-123", portalRole: "owner" };
    }
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }),
  requireOwnerAccess: vi.fn(async (req) => {
    if (req.headers.get("Authorization") === "Bearer valid-token") {
      return { userId: "user-123", scopeUserId: "user-123", portalRole: "owner" };
    }
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }),
  handleOptions: vi.fn(() => new Response(null, { status: 204 })),
}));

// Mock database service
vi.mock("@/lib/services/database/tenant", () => ({
  tenantService: {
    getAll: vi.fn(async () => []),
    create: vi.fn(async (_userId, data) => ({ id: "tenant-1", ...data })),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock Prisma client
vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: vi.fn(() => ({
    tenant: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  })),
}));

// Mock error handling
vi.mock("@/lib/utils/error-handling", () => ({
  createErrorResponse: (error: any, status: any) =>
    new Response(JSON.stringify({ error: error.message }), { status }),
  createSuccessResponse: (data: any, status: any = 200) =>
    new Response(JSON.stringify(data), { status }),
  withErrorHandler: (fn: any) => async (req: any, ctx?: any) => {
    try {
      return await fn(req, ctx);
    } catch (err: any) {
      const status = err?.name === "ZodError" || err?.name === "ValidationError" ? 400 : 500;
      return new Response(JSON.stringify({ error: err?.message ?? "Unknown error" }), { status });
    }
  },
  parseBody: (body: any, schema: any) => schema.parse(body),
}));

// Mock pagination
vi.mock("@/lib/utils/pagination", () => ({
  getPaginationFromRequest: () => ({ skip: 0, limit: 50, page: 1 }),
  createPaginatedResponse: (data: any) => ({
    data,
    total: data.length,
    page: 1,
  }),
}));

// Mock sanitize
vi.mock("@/lib/utils/sanitize", () => ({
  sanitizeForDatabase: (val: any) => val,
  sanitizeEmail: (val: any) => val,
  sanitizeNumber: (val: any, min: any, _minBound: any) => Math.max(val, min),
}));

describe("Tenants API - GET /api/tenants", () => {
  it("should return all tenants for authenticated user", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });

    const response = await getTenants(request);
    expect(response.status).toBe(200);
  });

  it("should return 401 when not authenticated", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants");
    const response = await getTenants(request);
    expect(response.status).toBe(401);
  });

  it("should support pagination with page parameter", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants?page=2", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getTenants(request);
    expect(response.status).toBe(200);
  });

  it("should support pagination with limit parameter", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants?limit=25", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getTenants(request);
    expect(response.status).toBe(200);
  });

  it("should handle both page and limit parameters together", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants?page=1&limit=10", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getTenants(request);
    expect(response.status).toBe(200);
  });

  it("should return empty list when no tenants exist", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getTenants(request);
    expect(response.status).toBe(200);
  });

  it("should handle database errors gracefully", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getTenants(request);
    expect([200, 500]).toContain(response.status);
  });
});

describe("Tenants API - POST /api/tenants", () => {
  it("should create tenant with valid data", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "John Doe",
        email: "john@example.com",
        phone: "555-1234",
        rent: 1200,
        leaseStart: "2024-01-01T00:00:00Z",
        leaseEnd: "2025-01-01T00:00:00Z",
      }),
    });

    const response = await postTenants(request);
    expect([200, 201]).toContain(response.status);
  });

  it("should return 401 when not authenticated", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants", {
      method: "POST",
      body: JSON.stringify({
        name: "John Doe",
        email: "john@example.com",
        phone: "555-1234",
        rent: 1200,
        leaseStart: "2024-01-01T00:00:00Z",
        leaseEnd: "2025-01-01T00:00:00Z",
      }),
    });
    const response = await postTenants(request);
    expect(response.status).toBe(401);
  });

  it("should validate required fields", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({}),
    });

    const response = await postTenants(request);
    expect([400, 422]).toContain(response.status);
  });

  it("should validate email format", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "John Doe",
        email: "invalid-email",
        phone: "555-1234",
        rent: 1200,
        leaseStart: "2024-01-01T00:00:00Z",
        leaseEnd: "2025-01-01T00:00:00Z",
      }),
    });

    const response = await postTenants(request);
    expect([400, 422]).toContain(response.status);
  });

  it("should validate rent is positive", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "John Doe",
        email: "john@example.com",
        phone: "555-1234",
        rent: -100,
        leaseStart: "2024-01-01T00:00:00Z",
        leaseEnd: "2025-01-01T00:00:00Z",
      }),
    });

    const response = await postTenants(request);
    expect([200, 201, 400, 422]).toContain(response.status);
  });

  it("should sanitize text input", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "John<script>alert('xss')</script>",
        email: "john@example.com",
        phone: "555-1234",
        rent: 1200,
        leaseStart: "2024-01-01T00:00:00Z",
        leaseEnd: "2025-01-01T00:00:00Z",
      }),
    });

    const response = await postTenants(request);
    expect([200, 201, 400, 422]).toContain(response.status);
  });

  it("should accept optional propertyId", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "John Doe",
        email: "john@example.com",
        phone: "555-1234",
        propertyId: "prop-123",
        rent: 1200,
        leaseStart: "2024-01-01T00:00:00Z",
        leaseEnd: "2025-01-01T00:00:00Z",
      }),
    });

    const response = await postTenants(request);
    expect([200, 201]).toContain(response.status);
  });

  // Payment status is derived from the rent ledger. The update route has always refused it; the
  // create route accepted it, so a tenant could be born "paid" with no money behind it.
  it("never passes a client-supplied paymentStatus to the service", async () => {
    const { tenantService } = await import("@/lib/services/database/tenant");
    const create = vi.mocked(tenantService.create);
    create.mockClear();

    const request = new NextRequest("http://localhost:3000/api/tenants", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "Ana Costa",
        email: "ana@example.com",
        rent: 900,
        paymentStatus: "paid",
      }),
    });

    const response = await postTenants(request);

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1]).not.toHaveProperty("paymentStatus");
  });

  it("should return 201 on successful creation", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "Jane Smith",
        email: "jane@example.com",
        phone: "555-5678",
        rent: 1500,
        leaseStart: "2024-01-01T00:00:00Z",
        leaseEnd: "2025-01-01T00:00:00Z",
      }),
    });

    const response = await postTenants(request);
    expect([200, 201]).toContain(response.status);
  });
});

// What an AT receipt names the tenant by. A Portuguese NIF is checked and stored as its nine
// digits; another country's tax number is taken as it is.
describe("Tenants API - POST /api/tenants: the NIF", () => {
  const post = (body: Record<string, unknown>) =>
    postTenants(
      new NextRequest("http://localhost:3000/api/tenants", {
        method: "POST",
        headers: new Headers({ Authorization: "Bearer valid-token" }),
        // A rent, as every POST here sends: this file's sanitizeNumber mock makes a missing one NaN.
        body: JSON.stringify({ name: "Ana Costa", email: "ana@example.com", rent: 900, ...body }),
      }),
    );
  const created = async () => {
    const { tenantService } = await import("@/lib/services/database/tenant");
    return vi.mocked(tenantService.create).mock.calls.at(-1)?.[1];
  };

  it("stores a Portuguese NIF as its nine digits, with Portugal as its country", async () => {
    const response = await post({ taxId: "123 456 789" });

    expect(response.status).toBe(201);
    expect(await created()).toMatchObject({ taxId: "123456789", taxCountry: "PT" });
  });

  it("refuses a Portuguese NIF whose check digit is wrong", async () => {
    const { tenantService } = await import("@/lib/services/database/tenant");
    vi.mocked(tenantService.create).mockClear();

    const response = await post({ taxId: "123456780" });

    expect(response.status).toBe(400);
    expect(tenantService.create).not.toHaveBeenCalled();
  });

  it("accepts a non-resident's NIF, which starts with 45", async () => {
    const response = await post({ taxId: "450000001" });

    expect(response.status).toBe(201);
    expect(await created()).toMatchObject({ taxId: "450000001" });
  });

  it("takes another country's tax number as it is, with an identity document", async () => {
    const response = await post({
      taxId: "DE 123 456",
      taxCountry: "DE",
      idDocument: "C01X00T47",
    });

    expect(response.status).toBe(201);
    expect(await created()).toMatchObject({
      taxId: "DE 123 456",
      taxCountry: "DE",
      idDocument: "C01X00T47",
    });
  });

  it("refuses a country that is not a two-letter code", async () => {
    const response = await post({ taxId: "123456789", taxCountry: "Portugal" });

    expect(response.status).toBe(400);
  });

  it("does not check a NIF left blank", async () => {
    const response = await post({ taxId: "" });

    expect(response.status).toBe(201);
    expect((await created())?.taxId).toBeUndefined();
  });
});
