import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `POST /api/expenses` checks the property an expense is booked against; `PUT /api/expenses/[id]`
 * accepted a new `propertyId` unchecked, and its response carries that property's name.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    expense: { findFirst: vi.fn(), update: vi.fn() },
    property: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1" })),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { PUT } from "./route";

const put = (body: unknown) =>
  PUT(
    new NextRequest("http://localhost:3000/api/expenses/exp-1", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: "exp-1" }) },
  );

describe("PUT /api/expenses/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.expense.findFirst.mockResolvedValue({ id: "exp-1", userId: "user-1" });
    prismaMock.expense.update.mockImplementation(async ({ data }) => ({
      id: "exp-1",
      ...data,
      property: { name: "Rua Augusta 12" },
    }));
  });

  it("refuses a property the caller does not own", async () => {
    prismaMock.property.findFirst.mockResolvedValue(null);

    const res = await put({ propertyId: "someone-elses-property" });

    expect(res.status).toBe(404);
    expect(prismaMock.expense.update).not.toHaveBeenCalled();
  });

  it("moves an expense to the caller's own property", async () => {
    prismaMock.property.findFirst.mockResolvedValue({ id: "prop-2" });

    const res = await put({ propertyId: "prop-2" });

    expect(res.status).toBe(200);
    expect(prismaMock.property.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "prop-2", userId: "user-1" } }),
    );
  });
});
