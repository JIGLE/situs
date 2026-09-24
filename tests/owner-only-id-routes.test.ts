/**
 * The collection routes of leases, receipts, properties and tenants admit owners only
 * (`requireOwnerAccess`), but their `[id]` routes checked for nothing more than a session
 * (`requireAuth`). A USER-role session, refused at every collection, could still read, change and
 * delete single records by id. The role check has to run before anything reaches the database,
 * which is why the database here throws instead of answering.
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(async () => ({
    user: { id: "user-1", email: "someone@example.com", role: "USER" },
    expires: "2099-01-01T00:00:00.000Z",
  })),
}));
vi.mock("@/lib/services/auth/auth", () => ({ getAuthOptions: () => ({}) }));
vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => {
    throw new Error("reached the database before the role check");
  },
}));

import * as leases from "@/app/api/leases/[id]/route";
import * as receipts from "@/app/api/receipts/[id]/route";
import * as properties from "@/app/api/properties/[id]/route";
import * as tenants from "@/app/api/tenants/[id]/route";

type Handler = (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;

const routes: Record<string, Record<string, unknown>> = { leases, receipts, properties, tenants };

const cases = Object.entries(routes).flatMap(([name, route]) =>
  (["GET", "PUT", "DELETE"] as const)
    .filter((method) => typeof route[method] === "function")
    .map((method) => [`${method} /api/${name}/[id]`, method, route[method] as Handler] as const),
);

describe("[id] routes admit owners only, as their collections do", () => {
  it("covers every handler of the four routes", () => {
    // leases/[id] has PUT and DELETE; the other three have GET, PUT and DELETE.
    expect(cases).toHaveLength(11);
  });

  it.each(cases)("%s refuses a USER-role session", async (_name, method, handler) => {
    const request = new NextRequest("http://localhost:3000/api/any/rec-1", {
      method,
      ...(method === "PUT"
        ? { body: JSON.stringify({}), headers: { "Content-Type": "application/json" } }
        : {}),
    });

    const response = await handler(request, { params: Promise.resolve({ id: "rec-1" }) });

    expect(response.status).toBe(403);
  });
});
