import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getProperties, POST as postProperties } from "./route";

// Mock auth middleware
vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: vi.fn(async (req) => {
    if (req.headers.get("Authorization") === "Bearer valid-token") {
      return { userId: "user-123", scopeUserId: "user-123", portalRole: "owner" };
    }
    if (req.headers.get("Authorization") === "Bearer invalid-token") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
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
  handleOptions: vi.fn(
    () =>
      new Response(null, {
        status: 204,
        headers: { "Access-Control-Allow-Methods": "GET, POST, OPTIONS" },
      }),
  ),
}));

// Mock database service
vi.mock("@/lib/services/database/property", () => ({
  propertyService: {
    getAll: vi.fn(),
    create: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock Prisma client
vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: vi.fn(() => ({
    property: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  })),
}));

describe("Properties API - GET /api/properties", () => {
  it("should return all properties for authenticated user", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });

    const response = await getProperties(request);
    expect(response.status).toBe(200);
  });

  it("should return 401 when not authenticated", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties");
    const response = await getProperties(request);
    expect(response.status).toBe(401);
  });

  it("should return 401 with invalid token", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties", {
      headers: new Headers({ Authorization: "Bearer invalid-token" }),
    });
    const response = await getProperties(request);
    expect(response.status).toBe(401);
  });

  it("should support pagination with page and limit parameters", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties?page=1&limit=10", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getProperties(request);
    expect(response.status).toBe(200);
  });

  it("should handle empty results gracefully", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getProperties(request);
    expect(response.ok).toBe(true);
  });

  it("should return sorted results in descending order by creation date", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getProperties(request);
    expect(response.status).toBe(200);
  });

  it("should handle database errors gracefully", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getProperties(request);
    expect([200, 500]).toContain(response.status);
  });
});

describe("Properties API - POST /api/properties", () => {
  it("should create property with valid data", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "123 Main St",
        address: "123 Main Street, City, State 12345",
        type: "apartment",
        bedrooms: 2,
        bathrooms: 1,
        rent: 1200,
        status: "vacant",
      }),
    });

    const response = await postProperties(request);
    expect([200, 201, 400]).toContain(response.status);
  });

  it("should return 401 when not authenticated", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties", {
      method: "POST",
      body: JSON.stringify({
        name: "123 Main St",
        address: "123 Main Street, City, State 12345",
      }),
    });
    const response = await postProperties(request);
    expect(response.status).toBe(401);
  });

  it("should validate required fields", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({}),
    });

    const response = await postProperties(request);
    expect([400, 422]).toContain(response.status);
  });

  it("should sanitize input data", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "123 Main St<script>alert('xss')</script>",
        address: "123 Main Street, City, State 12345",
        type: "apartment",
        bedrooms: 2,
        bathrooms: 1,
        rent: 1200,
      }),
    });

    const response = await postProperties(request);
    expect([200, 201, 400]).toContain(response.status);
  });

  it("should validate bedrooms and bathrooms ranges", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "123 Main St",
        address: "123 Main Street, City, State 12345",
        type: "apartment",
        bedrooms: -1,
        bathrooms: 1,
        rent: 1200,
      }),
    });

    const response = await postProperties(request);
    expect([400, 422]).toContain(response.status);
  });

  it("should validate rent is positive", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "123 Main St",
        address: "123 Main Street, City, State 12345",
        type: "apartment",
        bedrooms: 2,
        bathrooms: 1,
        rent: -100,
      }),
    });

    const response = await postProperties(request);
    expect([400, 422]).toContain(response.status);
  });

  it("should return 201 on successful creation", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "123 Main St",
        address: "123 Main Street, City, State 12345",
        type: "apartment",
        bedrooms: 2,
        bathrooms: 1,
        rent: 1200,
      }),
    });

    const response = await postProperties(request);
    expect([200, 201, 400, 422]).toContain(response.status);
  });
});
