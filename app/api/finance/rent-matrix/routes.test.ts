import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The two rent-matrix reads: the year, and one lease's month for the sheet. Both are the owner's
 * only, and both are scoped to the caller. A malformed month is a 400 the caller can act on, and
 * another owner's lease reads as one that does not exist.
 */

const { auth, readModel } = vi.hoisted(() => ({
  auth: { requireOwnerAccess: vi.fn() },
  readModel: { getRentMatrix: vi.fn(), getRentMonth: vi.fn() },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: auth.requireOwnerAccess,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/allocation/rent-matrix", () => readModel);

import { GET as getMatrix } from "./route";
import { GET as getMonth } from "./month/route";

const request = (path: string) => new NextRequest(`http://localhost:3000${path}`);

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireOwnerAccess.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
});

describe("GET /api/finance/rent-matrix", () => {
  it("reads the caller's year", async () => {
    readModel.getRentMatrix.mockResolvedValue({ year: 2025, rows: [], totals: {} });

    const res = await getMatrix(request("/api/finance/rent-matrix?year=2025"));

    expect(res.status).toBe(200);
    expect(readModel.getRentMatrix).toHaveBeenCalledWith("user-1", 2025);
    expect((await res.json()).data.year).toBe(2025);
  });

  it("falls back to this year for a year it cannot read", async () => {
    readModel.getRentMatrix.mockResolvedValue({ year: 2026, rows: [], totals: {} });

    await getMatrix(request("/api/finance/rent-matrix?year=abc"));

    expect(readModel.getRentMatrix).toHaveBeenCalledWith("user-1", new Date().getUTCFullYear());
  });

  it("answers the refusal and reads nothing for a caller who is not the owner", async () => {
    auth.requireOwnerAccess.mockResolvedValue(new Response(null, { status: 403 }));

    const res = await getMatrix(request("/api/finance/rent-matrix?year=2026"));

    expect(res.status).toBe(403);
    expect(readModel.getRentMatrix).not.toHaveBeenCalled();
  });
});

describe("GET /api/finance/rent-matrix/month", () => {
  const month = "/api/finance/rent-matrix/month";

  it("reads the caller's lease month", async () => {
    readModel.getRentMonth.mockResolvedValue({ lease: { id: "lease-1" }, period: null });

    const res = await getMonth(request(`${month}?leaseId=lease-1&year=2026&month=8`));

    expect(res.status).toBe(200);
    expect(readModel.getRentMonth).toHaveBeenCalledWith("user-1", "lease-1", 2026, 8);
    expect((await res.json()).data.lease.id).toBe("lease-1");
  });

  it.each([
    ["no lease", "?year=2026&month=8"],
    ["a thirteenth month", "?leaseId=lease-1&year=2026&month=13"],
    ["a month that is not a number", "?leaseId=lease-1&year=2026&month=aug"],
    ["no year", "?leaseId=lease-1&month=8"],
  ])("answers 400 for %s", async (_, query) => {
    const res = await getMonth(request(`${month}${query}`));

    expect(res.status).toBe(400);
    expect(readModel.getRentMonth).not.toHaveBeenCalled();
  });

  it("answers 404 for a lease that is not the caller's", async () => {
    readModel.getRentMonth.mockResolvedValue(null);

    const res = await getMonth(request(`${month}?leaseId=someone-elses&year=2026&month=8`));

    expect(res.status).toBe(404);
  });

  it("answers the refusal and reads nothing for a caller who is not the owner", async () => {
    auth.requireOwnerAccess.mockResolvedValue(new Response(null, { status: 403 }));

    const res = await getMonth(request(`${month}?leaseId=lease-1&year=2026&month=8`));

    expect(res.status).toBe(403);
    expect(readModel.getRentMonth).not.toHaveBeenCalled();
  });
});
