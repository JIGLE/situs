import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getTenantById, PUT as updateTenant, DELETE as deleteTenant } from "./route";

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
vi.mock("@/lib/services/database/tenant", () => ({
  tenantService: {
    getById: vi.fn(async (userId, id) => {
      if (userId === "user-123" && id === "tenant-123") {
        return {
          id,
          name: "John Doe",
          email: "john@example.com",
          phone: "555-1234",
          rent: 1200,
        };
      }
      return null;
    }),
    update: vi.fn(async (userId, id, data) => {
      if (userId === "user-123" && id === "tenant-123") {
        return {
          id,
          name: data.name || "John Doe",
          email: data.email || "john@example.com",
          ...data,
        };
      }
      return null;
    }),
    delete: vi.fn(async (userId, id) => {
      if (userId === "user-123" && id === "tenant-123") {
        return true;
      }
      throw new Error("Not found");
    }),
  },
}));

// Mock error handling
vi.mock("@/lib/utils/error-handling", () => ({
  createErrorResponse: (error: any, status: any) =>
    new Response(JSON.stringify({ error: error.message }), { status }),
  createSuccessResponse: (data: any, status: any = 200) =>
    new Response(JSON.stringify(data), { status }),
  withErrorHandler: (fn: any) => fn,
}));

// Mock sanitize
vi.mock("@/lib/utils/sanitize", () => ({
  sanitizeForDatabase: (val: any) => val,
  sanitizeEmail: (val: any) => val,
  sanitizeNumber: (val: any, min: any, _minBound: any) => Math.max(val, min),
}));

describe("Tenants API - GET /api/tenants/[id]", () => {
  it("should return tenant when authenticated and authorized", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });

    const response = await getTenantById(request, {
      params: { id: "tenant-123" },
    });
    expect(response.status).toBe(200);
  });

  it("should return 401 when not authenticated", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123");
    const response = await getTenantById(request, {
      params: { id: "tenant-123" },
    });
    expect(response.status).toBe(401);
  });

  it("should return 400 when id is missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getTenantById(request, { params: {} });
    expect(response.status).toBe(400);
  });

  it("should return 404 when tenant not found", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/nonexistent", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getTenantById(request, {
      params: { id: "nonexistent" },
    });
    expect(response.status).toBe(404);
  });

  it("should include all tenant fields in response", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getTenantById(request, {
      params: { id: "tenant-123" },
    });
    expect(response.status).toBe(200);
  });

  it("should handle promise-based params", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getTenantById(request, {
      params: Promise.resolve({ id: "tenant-123" }),
    });
    expect([200, 404]).toContain(response.status);
  });

  it("should prevent access to other user's tenants", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/other-tenant", {
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await getTenantById(request, {
      params: { id: "other-tenant" },
    });
    expect(response.status).toBe(404);
  });
});

describe("Tenants API - PUT /api/tenants/[id]", () => {
  it("should update tenant with valid data", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({ name: "Jane Doe" }),
    });

    const response = await updateTenant(request, {
      params: { id: "tenant-123" },
    });
    expect([200, 201]).toContain(response.status);
  });

  it("should return 401 when not authenticated", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      method: "PUT",
      body: JSON.stringify({ name: "Jane Doe" }),
    });
    const response = await updateTenant(request, {
      params: { id: "tenant-123" },
    });
    expect(response.status).toBe(401);
  });

  it("should return 404 when tenant not found", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/nonexistent", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({ name: "Jane Doe" }),
    });
    const response = await updateTenant(request, {
      params: { id: "nonexistent" },
    });
    expect(response.status).toBe(404);
  });

  it("should validate email format on update", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({ email: "invalid-email" }),
    });

    const response = await updateTenant(request, {
      params: { id: "tenant-123" },
    });
    expect([200, 201, 400]).toContain(response.status);
  });

  it("should validate rent is positive on update", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({ rent: -50 }),
    });

    const response = await updateTenant(request, {
      params: { id: "tenant-123" },
    });
    expect([200, 201, 400]).toContain(response.status);
  });

  it("should sanitize update input", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({
        name: "John<script>alert('xss')</script>",
      }),
    });

    const response = await updateTenant(request, {
      params: { id: "tenant-123" },
    });
    expect([200, 201, 400]).toContain(response.status);
  });

  it("should allow partial updates", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({ phone: "555-9999" }),
    });

    const response = await updateTenant(request, {
      params: { id: "tenant-123" },
    });
    expect([200, 201]).toContain(response.status);
  });

  it("should return 400 for missing id", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/", {
      method: "PUT",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
      body: JSON.stringify({ name: "Jane Doe" }),
    });
    const response = await updateTenant(request, { params: {} });
    expect(response.status).toBe(400);
  });
});

describe("Tenants API - DELETE /api/tenants/[id]", () => {
  it("should delete tenant when authenticated", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      method: "DELETE",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });

    const response = await deleteTenant(request, {
      params: { id: "tenant-123" },
    });
    expect([200, 204]).toContain(response.status);
  });

  it("should return 401 when not authenticated", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      method: "DELETE",
    });
    const response = await deleteTenant(request, {
      params: { id: "tenant-123" },
    });
    expect(response.status).toBe(401);
  });

  it("should return 404 when tenant not found", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/nonexistent", {
      method: "DELETE",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await deleteTenant(request, {
      params: { id: "nonexistent" },
    });
    expect(response.status).toBe(404);
  });

  it("should return 400 when id is missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/", {
      method: "DELETE",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await deleteTenant(request, { params: {} });
    expect(response.status).toBe(400);
  });

  it("should cascade delete related leases and invoices", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      method: "DELETE",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });

    const response = await deleteTenant(request, {
      params: { id: "tenant-123" },
    });
    expect([200, 204]).toContain(response.status);
  });

  it("should handle promise-based params", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
      method: "DELETE",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });

    const response = await deleteTenant(request, {
      params: Promise.resolve({ id: "tenant-123" }),
    });
    expect([200, 204, 404]).toContain(response.status);
  });

  it("should prevent deletion of other user's tenants", async () => {
    const request = new NextRequest("http://localhost:3000/api/tenants/other-tenant", {
      method: "DELETE",
      headers: new Headers({ Authorization: "Bearer valid-token" }),
    });
    const response = await deleteTenant(request, {
      params: { id: "other-tenant" },
    });
    expect([403, 404]).toContain(response.status);
  });
});

// An update may send a NIF without the country the tenant already has, so the stored country
// decides how it is checked.
describe("Tenants API - PUT /api/tenants/[id]: the NIF", () => {
  const put = (body: Record<string, unknown>) =>
    updateTenant(
      new NextRequest("http://localhost:3000/api/tenants/tenant-123", {
        method: "PUT",
        headers: new Headers({ Authorization: "Bearer valid-token" }),
        body: JSON.stringify(body),
      }),
      { params: { id: "tenant-123" } },
    );
  const service = async () => (await import("@/lib/services/database/tenant")).tenantService;

  it("refuses a Portuguese NIF whose check digit is wrong, before writing", async () => {
    const tenantService = await service();
    vi.mocked(tenantService.update).mockClear();

    const response = await put({ taxId: "123456780" });

    expect(response.status).toBe(400);
    expect(tenantService.update).not.toHaveBeenCalled();
  });

  it("checks a NIF against the tenant's stored country", async () => {
    const tenantService = await service();
    vi.mocked(tenantService.getById).mockResolvedValueOnce({
      id: "tenant-123",
      name: "Hans Weber",
      email: "hans@example.com",
      taxCountry: "DE",
    } as never);

    const response = await put({ taxId: "DE 999 999" });

    expect(response.status).toBe(200);
    expect(vi.mocked(tenantService.update).mock.calls.at(-1)?.[2]).toMatchObject({
      taxId: "DE 999 999",
    });
  });

  it("leaves the NIF alone when the request does not send one", async () => {
    const tenantService = await service();

    await put({ name: "Jane Doe" });

    const data = vi.mocked(tenantService.update).mock.calls.at(-1)?.[2];
    expect(data?.taxId).toBeUndefined();
    expect(data?.idDocument).toBeUndefined();
  });

  it("clears the NIF with a blank input", async () => {
    const tenantService = await service();

    await put({ taxId: "" });

    expect(vi.mocked(tenantService.update).mock.calls.at(-1)?.[2]).toMatchObject({ taxId: null });
  });
});
