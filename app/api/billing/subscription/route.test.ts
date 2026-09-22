import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireAuthMock, getCurrentPlanInfoMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getCurrentPlanInfoMock: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: requireAuthMock,
}));

vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/billing/subscription-service", () => ({
  getCurrentPlanInfo: getCurrentPlanInfoMock,
}));

import { GET } from "./route";

describe("GET /api/billing/subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: "user-123" });
  });

  it("returns the authenticated user's plan info", async () => {
    getCurrentPlanInfoMock.mockResolvedValue({
      plan: "pro",
      status: "active",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      maxProperties: 10,
      propertyCount: 3,
    });

    const response = await GET(new NextRequest("http://localhost:3000/api/billing/subscription"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getCurrentPlanInfoMock).toHaveBeenCalledWith(expect.anything(), "user-123");
    expect(body.data.plan).toBe("pro");
    expect(body.data.propertyCount).toBe(3);
  });

  it("returns the auth failure response when unauthenticated", async () => {
    const unauthorized = new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    requireAuthMock.mockResolvedValue(unauthorized);

    const response = await GET(new NextRequest("http://localhost:3000/api/billing/subscription"));

    expect(response.status).toBe(401);
    expect(getCurrentPlanInfoMock).not.toHaveBeenCalled();
  });
});
