// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ResourceNotFoundError } from "@/lib/utils/error-handling";

/**
 * Writing a reviewed contract. The transaction is tested beside it (lib/services/contracts); here,
 * the route: who may call it, that a review breaking the sheet's rules is a 400 and not a write,
 * and that the two refusals a person can act on come back as such.
 */

const { access, importContract } = vi.hoisted(() => ({
  access: vi.fn(),
  importContract: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({ requireOwnerAccess: access }));
vi.mock("@/lib/services/contracts/import", () => ({ importContract }));
import { POST } from "./route";

const review = {
  property: { mode: "existing", id: "property-1" },
  landlords: [],
  tenant: { mode: "existing", id: "tenant-1" },
  parties: [],
  lease: {
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    monthlyRent: 950,
    deposit: 1900,
    autoRenew: true,
    renewalNoticeDays: 120,
  },
  clauses: [],
};

const importRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/contracts/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("POST /api/contracts/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
    importContract.mockResolvedValue({
      leaseId: "lease-1",
      propertyId: "property-1",
      tenantId: "tenant-1",
    });
  });

  it("writes a confirmed review for the caller", async () => {
    const res = await POST(importRequest(review));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      data: { leaseId: "lease-1", propertyId: "property-1", tenantId: "tenant-1" },
    });
    expect(importContract).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ lease: review.lease }),
    );
  });

  it("refuses the signed-out", async () => {
    access.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await POST(importRequest(review))).status).toBe(401);
    expect(importContract).not.toHaveBeenCalled();
  });

  it("refuses a review that breaks the sheet's rules, and writes nothing", async () => {
    const res = await POST(
      importRequest({ ...review, lease: { ...review.lease, endDate: "2025-12-31" } }),
    );

    expect(res.status).toBe(400);
    expect(importContract).not.toHaveBeenCalled();
  });

  it("names an email already in use, and an id that is not the caller's", async () => {
    importContract.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7",
        meta: { target: ["email"] },
      }),
    );
    const taken = await POST(importRequest(review));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ reason: "email_taken" });

    importContract.mockRejectedValueOnce(new ResourceNotFoundError("Property not found"));
    expect((await POST(importRequest(review))).status).toBe(404);
  });
});
