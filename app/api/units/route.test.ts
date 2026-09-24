import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireAuthMock, propertyFindFirst, unitCreate, unitFindFirst, unitUpdate } = vi.hoisted(
  () => ({
    requireAuthMock: vi.fn(),
    propertyFindFirst: vi.fn(),
    unitCreate: vi.fn(),
    unitFindFirst: vi.fn(),
    unitUpdate: vi.fn(),
  }),
);

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: requireAuthMock,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/config/data-mode", () => ({ isMockMode: false }));
vi.mock("@/lib/utils/rate-limit", () => ({ withRateLimit: (handler: unknown) => handler }));
vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => ({
    property: { findFirst: propertyFindFirst },
    unit: { create: unitCreate, findFirst: unitFindFirst, update: unitUpdate },
  }),
}));

import { POST } from "./route";
import { PUT } from "./[id]/route";

function request(method: string, body: unknown) {
  return new NextRequest("http://localhost:3000/api/units", {
    method,
    body: JSON.stringify(body),
  });
}

const put = (body: unknown) =>
  PUT(request("PUT", body), { params: Promise.resolve({ id: "unit-1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ userId: "user-123" });
  propertyFindFirst.mockResolvedValue({ id: "prop-1", userId: "user-123" });
  unitFindFirst.mockResolvedValue({ id: "unit-1", propertyId: "prop-1" });
  unitCreate.mockImplementation(async ({ data }) => ({ id: "unit-1", ...data }));
  unitUpdate.mockImplementation(async ({ data }) => ({ id: "unit-1", ...data }));
});

describe("POST /api/units", () => {
  it("stores a ground floor and a T0's zero bedrooms as 0, not as empty", async () => {
    const response = await POST(
      request("POST", { propertyId: "prop-1", number: "R/C", floor: 0, bedrooms: 0 }),
    );

    expect(response.status).toBe(201);
    expect(unitCreate.mock.calls[0][0].data).toMatchObject({ floor: 0, bedrooms: 0 });
  });

  it.each([
    ["an unknown status", { propertyId: "prop-1", number: "1A", status: "banana" }],
    ["a floor that is not a number", { propertyId: "prop-1", number: "1A", floor: "2" }],
    ["no unit number", { propertyId: "prop-1" }],
    ["no property", { number: "1A" }],
  ])("answers 400 for %s and creates nothing", async (_label, body) => {
    const response = await POST(request("POST", body));

    expect(response.status).toBe(400);
    expect(unitCreate).not.toHaveBeenCalled();
  });

  it("refuses a property the caller does not own", async () => {
    propertyFindFirst.mockResolvedValue(null);

    const response = await POST(request("POST", { propertyId: "someone-elses", number: "1A" }));

    expect(response.status).toBe(404);
    expect(unitCreate).not.toHaveBeenCalled();
  });
});

describe("PUT /api/units/[id]", () => {
  it("changes only what it is sent", async () => {
    const response = await put({ notes: "New boiler" });

    expect(response.status).toBe(200);
    expect(unitUpdate.mock.calls[0][0].data).toEqual({ notes: "New boiler" });
  });

  it("keeps a floor of 0 and clears a field sent as null", async () => {
    await put({ floor: 0, sizeSqM: null });

    expect(unitUpdate.mock.calls[0][0].data).toEqual({ floor: 0, sizeSqM: null });
  });

  it("answers 400 for an unknown status and writes nothing", async () => {
    const response = await put({ status: "banana" });

    expect(response.status).toBe(400);
    expect(unitUpdate).not.toHaveBeenCalled();
  });

  it("never moves a unit to another property", async () => {
    await put({ propertyId: "someone-elses", notes: "x" });

    expect(unitUpdate.mock.calls[0][0].data).not.toHaveProperty("propertyId");
  });

  it("answers 404 for a unit the caller does not own", async () => {
    unitFindFirst.mockResolvedValue(null);

    const response = await put({ notes: "x" });

    expect(response.status).toBe(404);
    expect(unitUpdate).not.toHaveBeenCalled();
  });
});
