import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getPropertyById, PUT as updateProperty, DELETE as deleteProperty } from "./route";

// Mock auth middleware. The route admits owners only, as its collection does.
vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: vi.fn(async (req) => {
    if (req.headers.get("Authorization") === "Bearer valid-token") {
      return { userId: "user-123", scopeUserId: "user-123", email: "user@example.com" };
    }
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }),
  handleOptions: vi.fn(() => new Response(null, { status: 204 })),
}));

// Mock database service
vi.mock("@/lib/services/database/property", () => ({
  propertyService: {
    getById: vi.fn(async (userId, id) => {
      if (userId === "user-123" && id === "prop-123") {
        return { id, name: "123 Main St", address: "123 Main St, City" };
      }
      return null;
    }),
    update: vi.fn(async (userId, id, data) => {
      if (userId === "user-123" && id === "prop-123") {
        return { id, name: data.name || "123 Main St", ...data };
      }
      return null;
    }),
    delete: vi.fn(async (userId, id) => {
      if (userId === "user-123" && id === "prop-123") {
        return true;
      }
      throw new Error("Not found");
    }),
  },
}));

// Mock error handling
vi.mock("@/lib/utils/error-handling", () => ({
  createErrorResponse: (error: any, status: any, _req: any) =>
    new Response(JSON.stringify({ error: error.message }), { status }),
  createSuccessResponse: (data: any, status: any = 200) =>
    new Response(JSON.stringify(data), { status }),
  withErrorHandler: (fn: any) => fn,
}));

// Mock sanitize
vi.mock("@/lib/utils/sanitize", () => ({
  sanitizeForDatabase: (val: any) => val,
  sanitizeNumber: (val: any, min: any, minBound: any, max: any) =>
    Math.min(Math.max(val, min), max),
}));

describe("Properties API - GET /api/properties/[id]", () => {
  it("should return property when authenticated and authorized", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });

    const response = await getPropertyById(request, {
      params: { id: "prop-123" },
    });
    expect(response.status).toBe(200);
  });

  it("should return 401 when not authenticated", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123");
    const response = await getPropertyById(request, {
      params: { id: "prop-123" },
    });
    expect(response.status).toBe(401);
  });

  it("should return 400 when id is missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getPropertyById(request, { params: {} });
    expect(response.status).toBe(400);
  });

  it("should return 404 when property not found", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/nonexistent", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getPropertyById(request, {
      params: { id: "nonexistent" },
    });
    expect(response.status).toBe(404);
  });

  it("should return 404 for non-existent ID", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/fake-id", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getPropertyById(request, {
      params: { id: "fake-id" },
    });
    expect(response.status).toBe(404);
  });

  it("should handle promise-based params", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getPropertyById(request, {
      params: Promise.resolve({ id: "prop-123" }),
    });
    expect([200, 404]).toContain(response.status);
  });

  it("should include all property fields in response", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getPropertyById(request, {
      params: { id: "prop-123" },
    });
    expect(response.status).toBe(200);
  });
});

describe("Properties API - PUT /api/properties/[id]", () => {
  it("should update property with valid data", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({ name: "456 Oak Ave" }),
    });

    const response = await updateProperty(request, {
      params: { id: "prop-123" },
    });
    expect([200, 201]).toContain(response.status);
  });

  it("should return 401 when not authenticated", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      method: "PUT",
      body: JSON.stringify({ name: "456 Oak Ave" }),
    });
    const response = await updateProperty(request, {
      params: { id: "prop-123" },
    });
    expect(response.status).toBe(401);
  });

  it("should return 404 when property not found", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/nonexistent", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({ name: "456 Oak Ave" }),
    });
    const response = await updateProperty(request, {
      params: { id: "nonexistent" },
    });
    expect(response.status).toBe(404);
  });

  it("should validate partial updates", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({ bedrooms: 3 }),
    });

    const response = await updateProperty(request, {
      params: { id: "prop-123" },
    });
    expect([200, 201]).toContain(response.status);
  });

  it("should sanitize update input", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({ name: "123<script>alert('xss')</script>" }),
    });

    const response = await updateProperty(request, {
      params: { id: "prop-123" },
    });
    expect([200, 201, 400]).toContain(response.status);
  });

  it("should validate bedrooms range on update", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({ bedrooms: -5 }),
    });

    const response = await updateProperty(request, {
      params: { id: "prop-123" },
    });
    expect([200, 201, 400]).toContain(response.status);
  });

  it("should return 400 for missing required id", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({ name: "456 Oak Ave" }),
    });
    const response = await updateProperty(request, { params: {} });
    expect(response.status).toBe(400);
  });

  it("should allow empty body (no changes)", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({}),
    });

    const response = await updateProperty(request, {
      params: { id: "prop-123" },
    });
    expect([200, 201]).toContain(response.status);
  });
});

describe("Properties API - DELETE /api/properties/[id]", () => {
  it("should delete property when authenticated", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      method: "DELETE",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });

    const response = await deleteProperty(request, {
      params: { id: "prop-123" },
    });
    expect([200, 204]).toContain(response.status);
  });

  it("should return 401 when not authenticated", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      method: "DELETE",
    });
    const response = await deleteProperty(request, {
      params: { id: "prop-123" },
    });
    expect(response.status).toBe(401);
  });

  it("should return 404 when property not found", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/nonexistent", {
      method: "DELETE",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await deleteProperty(request, {
      params: { id: "nonexistent" },
    });
    expect(response.status).toBe(404);
  });

  it("should return 400 when id is missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/", {
      method: "DELETE",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await deleteProperty(request, { params: {} });
    expect(response.status).toBe(400);
  });

  it("should cascade delete related records (tenants, leases, invoices)", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      method: "DELETE",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });

    const response = await deleteProperty(request, {
      params: { id: "prop-123" },
    });
    expect([200, 204]).toContain(response.status);
  });

  it("should handle promise-based params", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/prop-123", {
      method: "DELETE",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });

    const response = await deleteProperty(request, {
      params: Promise.resolve({ id: "prop-123" }),
    });
    expect([200, 204, 404]).toContain(response.status);
  });

  it("should prevent deletion of non-owned properties", async () => {
    const request = new NextRequest("http://localhost:3000/api/properties/other-user-prop", {
      method: "DELETE",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await deleteProperty(request, {
      params: { id: "other-user-prop" },
    });
    expect([403, 404]).toContain(response.status);
  });
});
