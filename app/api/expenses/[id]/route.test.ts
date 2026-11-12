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

  it("takes the form's own fields, and an expense that stops repeating loses its rule", async () => {
    const res = await put({ amount: 45, isDeductible: false, isRecurring: false });

    expect(res.status).toBe(200);
    expect(prismaMock.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 45,
          isDeductible: false,
          isRecurring: false,
          recurrenceRule: null,
          recurrenceDay: null,
          recurrenceEnd: null,
        }),
      }),
    );
  });

  it("stores an end date as a date", async () => {
    await put({ recurrenceEnd: "2027-06-30" });

    const { data } = prismaMock.expense.update.mock.calls[0][0];
    expect(data.recurrenceEnd).toEqual(new Date("2027-06-30"));
    // Fields the request left out keep their stored values, not the new-expense defaults.
    expect(data).not.toHaveProperty("isDeductible");
    expect(data).not.toHaveProperty("isRecurring");
  });

  it("refuses a category that is not one of the list", async () => {
    const res = await put({ category: "bribes" });

    expect(res.status).toBe(400);
    expect(prismaMock.expense.update).not.toHaveBeenCalled();
  });
});
