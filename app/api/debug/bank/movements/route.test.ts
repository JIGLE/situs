import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `/api/debug/bank/movements` writes bank movements from a request body, which is exactly what
 * the removed CSV import did for everyone. It exists for E2E, so it must be closed wherever demo
 * mode is not explicitly on — and the check has to come before the session is even read.
 */

const { importBankRows, requireOwnerAccess } = vi.hoisted(() => ({
  importBankRows: vi.fn(async () => ({
    jobId: "job-1",
    imported: 1,
    duplicates: 0,
    autoMatched: 0,
    needsReview: 1,
    errors: [],
  })),
  requireOwnerAccess: vi.fn(async () => ({ userId: "user-1", scopeUserId: "owner-1" })),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/bank/import", () => ({ importBankRows }));

import { POST } from "./route";

const row = { bookingDate: "2026-09-01", amount: 850, reference: "renda 09/2026" };
const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost:3000/api/debug/bank/movements", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("POST /api/debug/bank/movements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is closed outside demo mode, before it reads a session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEMO_MODE", "");

    const res = await post({ rows: [row] });

    expect(res.status).toBe(403);
    expect(requireOwnerAccess).not.toHaveBeenCalled();
    expect(importBankRows).not.toHaveBeenCalled();
  });

  it("in demo mode, puts the rows through the import a sync uses, for the caller's scope", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEMO_MODE", "true");

    const res = await post({ rows: [row] });

    expect(res.status).toBe(201);
    expect(importBankRows).toHaveBeenCalledWith("owner-1", [row], "manual_entry");
    expect((await res.json()).data).toMatchObject({ imported: 1 });
  });

  it("refuses a body without rows", async () => {
    vi.stubEnv("ALLOW_DEMO_MODE", "true");

    const res = await post({ csv: "Date,Amount\n2026-09-01,850" });

    expect(res.status).toBe(400);
    expect(importBankRows).not.toHaveBeenCalled();
  });
});
