import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * What the tenant routes do with the email and the phone a request carries, through the real
 * sanitizers and the real error handling: the other tests of these routes stand a mock in for both,
 * which is how a mock came to hide that a number was read as "clear it".
 *
 * Absent leaves a field alone; null or blank clears it; text is checked; and anything else, which
 * `sanitizeEmail` and `sanitizeForDatabase` both turn into "nothing", is the caller's mistake and a
 * 400, not a silent clear.
 */

const { requireOwnerAccessMock, tenantServiceMock } = vi.hoisted(() => ({
  requireOwnerAccessMock: vi.fn(),
  tenantServiceMock: { create: vi.fn(), update: vi.fn(), getById: vi.fn(), getAll: vi.fn() },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: requireOwnerAccessMock,
  getAccessContext: vi.fn(),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/tenant", () => ({ tenantService: tenantServiceMock }));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: vi.fn() }));

import { POST } from "./route";
import { PUT } from "./[id]/route";
import { EmailInUseError } from "@/lib/services/database/unique-email";

const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest("http://localhost:3000/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Ana Costa", rent: 900, ...body }),
      headers: { "Content-Type": "application/json" },
    }),
  );
const put = (body: Record<string, unknown>) =>
  PUT(
    new NextRequest("http://localhost:3000/api/tenants/t1", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: { id: "t1" } },
  );
const created = () => tenantServiceMock.create.mock.calls.at(-1)?.[1];
const updated = () => tenantServiceMock.update.mock.calls.at(-1)?.[2];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireOwnerAccessMock.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
  tenantServiceMock.getById.mockResolvedValue({ id: "t1", name: "Ana Costa", taxCountry: "PT" });
  tenantServiceMock.create.mockImplementation(async (_userId, data) => ({ id: "t1", ...data }));
  tenantServiceMock.update.mockImplementation(async (_userId, id, data) => ({ id, ...data }));
});

describe("POST /api/tenants, the email", () => {
  it("creates a tenant with no email, and says so to the service", async () => {
    const res = await post({});

    expect(res.status).toBe(201);
    expect(created()).toMatchObject({ email: null });
  });

  it.each([42, true, ["ana@example.com"], { a: 1 }])(
    "refuses an email that is not text (%j), rather than creating the tenant without one",
    async (email) => {
      const res = await post({ email });

      expect(res.status).toBe(400);
      expect(tenantServiceMock.create).not.toHaveBeenCalled();
    },
  );

  it("refuses a typo, and lower-cases an address", async () => {
    expect((await post({ email: "not-an-email" })).status).toBe(400);

    const ok = await post({ email: " Ana@Example.COM " });
    expect(ok.status).toBe(201);
    expect(created()).toMatchObject({ email: "ana@example.com" });
  });

  it("answers an email the account already has as a 409 `email_in_use`", async () => {
    tenantServiceMock.create.mockRejectedValue(new EmailInUseError("tenant"));

    const res = await post({ email: "ana@example.com" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "email_in_use" });
  });
});

describe("PUT /api/tenants/[id], the email and the phone", () => {
  it("clears an email sent null or blank", async () => {
    for (const email of [null, "", "   "]) {
      const res = await put({ email });

      expect(res.status).toBe(200);
      expect(updated()).toHaveProperty("email", null);
    }
  });

  it("clears a phone sent null or blank", async () => {
    for (const phone of [null, "", "   "]) {
      const res = await put({ phone });

      expect(res.status).toBe(200);
      // Blank: the service stores it as NULL (`blankToNull`).
      expect(updated()?.phone ?? "").toBe("");
    }
  });

  it("leaves both alone when the edit does not send them", async () => {
    const res = await put({ name: "Ana Costa-Silva" });

    expect(res.status).toBe(200);
    expect(updated()?.email).toBeUndefined();
    expect(updated()?.phone).toBeUndefined();
  });

  it.each([42, true, ["ana@example.com"]])(
    "refuses an email that is not text (%j), and does not clear the one on file",
    async (email) => {
      const res = await put({ email });

      expect(res.status).toBe(400);
      expect(tenantServiceMock.update).not.toHaveBeenCalled();
    },
  );

  it.each([912345678, true, ["912"]])(
    "refuses a phone that is not text (%j), and does not clear the one on file",
    async (phone) => {
      const res = await put({ phone });

      expect(res.status).toBe(400);
      expect(tenantServiceMock.update).not.toHaveBeenCalled();
    },
  );

  it("refuses a typo, and still saves a phone and an address that are there", async () => {
    expect((await put({ email: "not-an-email" })).status).toBe(400);

    const ok = await put({ email: "Ana@Example.COM", phone: "912 345 678" });
    expect(ok.status).toBe(200);
    expect(updated()).toMatchObject({ email: "ana@example.com", phone: "912 345 678" });
  });

  it("answers an email another tenant of the account has as a 409 `email_in_use`", async () => {
    tenantServiceMock.update.mockRejectedValue(new EmailInUseError("tenant"));

    const res = await put({ email: "ana@example.com" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "email_in_use" });
  });
});
