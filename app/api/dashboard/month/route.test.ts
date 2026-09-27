import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** The dashboard month route: who may read it, and what it accepts. */

const { access, monthMock } = vi.hoisted(() => ({ access: vi.fn(), monthMock: vi.fn() }));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: access,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/dashboard/month", () => ({ getDashboardMonth: monthMock }));

import { GET } from "./route";

const read = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/dashboard/month${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
  monthMock.mockResolvedValue({ year: 2026, month: 9 });
});

describe("GET /api/dashboard/month", () => {
  it("reads the month of the owner whose records the caller acts on", async () => {
    access.mockResolvedValue({ userId: "manager-1", scopeUserId: "owner-1" });

    const res = await read("?year=2026&month=9");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { year: 2026, month: 9 } });
    expect(monthMock).toHaveBeenCalledWith("owner-1", 2026, 9);
  });

  it("refuses a month that does not exist, or none, as a 400", async () => {
    for (const query of [
      "?year=2026&month=13",
      "?year=2026&month=0",
      "?month=9",
      "",
      "?year=x&month=9",
    ]) {
      expect((await read(query)).status).toBe(400);
    }
    expect(monthMock).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not an owner before reading anything", async () => {
    access.mockResolvedValue(new Response(null, { status: 403 }));

    expect((await read("?year=2026&month=9")).status).toBe(403);
    expect(monthMock).not.toHaveBeenCalled();
  });
});
