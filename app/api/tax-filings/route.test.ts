import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A tax filing is saved by upsert: the same POST creates the year's filing and later updates it.
 * `status` defaulted to "draft" in the one schema both paths share, so re-saving a finalised filing
 * without restating its status quietly reverted it to a draft.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { taxFiling: { upsert: vi.fn() } },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1" })),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { POST } from "./route";

const filing = {
  year: 2026,
  country: "PT",
  regime: "portugal_rendimentos",
  propertyIds: ["prop-1"],
  grossIncome: 11400,
  allowableExpenses: 1200,
  taxableIncome: 10200,
  taxDue: 2856,
  effectiveRate: 0.25,
  withholdingPaid: 0,
  balanceDue: 2856,
  payload: "{}",
};

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost:3000/api/tax-filings", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("POST /api/tax-filings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.taxFiling.upsert.mockImplementation(async ({ create }) => ({
      id: "f-1",
      ...create,
    }));
  });

  it("does not revert a saved filing's status when the save leaves it out", async () => {
    const res = await post(filing);

    expect(res.status).toBe(200);
    const { create, update } = prismaMock.taxFiling.upsert.mock.calls[0][0];
    expect(create.status).toBe("draft");
    // `undefined` is Prisma's "leave this column alone".
    expect(update.status).toBeUndefined();
  });

  it("still updates the status when the save sends one", async () => {
    await post({ ...filing, status: "final" });

    const { update } = prismaMock.taxFiling.upsert.mock.calls[0][0];
    expect(update.status).toBe("final");
  });
});
