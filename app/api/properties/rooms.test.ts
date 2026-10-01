import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Finanças does not say how many rooms a property has, so they are optional, and unknown is NULL.
 * The route used to pass them through `sanitizeNumber(value, 0, 0, 20)`, whose default is 0: a
 * property with no rooms given would have been filed as a studio.
 */

const { requireOwnerAccessMock, propertyServiceMock } = vi.hoisted(() => ({
  requireOwnerAccessMock: vi.fn(),
  propertyServiceMock: { create: vi.fn(), getAll: vi.fn() },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: requireOwnerAccessMock,
  getAccessContext: vi.fn(),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/property", () => ({ propertyService: propertyServiceMock }));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: vi.fn() }));

import { POST } from "./route";

const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest("http://localhost:3000/api/properties", {
      method: "POST",
      body: JSON.stringify({
        name: "Rua Augusta 12",
        address: "Rua Augusta 12, Lisboa",
        type: "apartment",
        rent: 950,
        status: "vacant",
        ...body,
      }),
      headers: { "Content-Type": "application/json" },
    }),
  );
const created = () => propertyServiceMock.create.mock.calls.at(-1)?.[1];

describe("POST /api/properties: the rooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    requireOwnerAccessMock.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
    propertyServiceMock.create.mockImplementation(async (_userId, data) => ({ id: "p1", ...data }));
  });

  it("files rooms that are not given as unknown, not as 0", async () => {
    const res = await post({});

    expect(res.status).toBe(201);
    expect(created()).toMatchObject({ bedrooms: null, bathrooms: null });
  });

  it("files rooms sent as null as unknown too", async () => {
    await post({ bedrooms: null, bathrooms: null });

    expect(created()).toMatchObject({ bedrooms: null, bathrooms: null });
  });

  it("keeps 0, a studio, as 0, and the count it is given as it is", async () => {
    await post({ bedrooms: 0, bathrooms: 2 });

    expect(created()).toMatchObject({ bedrooms: 0, bathrooms: 2 });
  });

  it("still refuses a count out of range, and creates nothing", async () => {
    const res = await post({ bedrooms: 21 });

    expect(res.status).toBe(400);
    expect(propertyServiceMock.create).not.toHaveBeenCalled();
  });
});
