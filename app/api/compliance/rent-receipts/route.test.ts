import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { requireAuthMock, listRentReceiptsMock, createRentReceiptMock, logAuditMock, prismaMock } =
  vi.hoisted(() => ({
    requireAuthMock: vi.fn(),
    listRentReceiptsMock: vi.fn(),
    createRentReceiptMock: vi.fn(),
    logAuditMock: vi.fn(),
    prismaMock: {
      tenant: { findFirst: vi.fn() },
      property: { findFirst: vi.fn() },
      lease: { findFirst: vi.fn() },
    },
  }));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: requireAuthMock,
}));

vi.mock("@/lib/compliance/rent-receipts-pt", () => ({
  listRentReceipts: listRentReceiptsMock,
  createRentReceipt: createRentReceiptMock,
}));

vi.mock("@/lib/services/audit-log", () => ({
  logAudit: logAuditMock,
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { GET, POST } from "./route";

describe("Compliance rent receipts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: "user-321" });
    logAuditMock.mockResolvedValue(undefined);
    prismaMock.tenant.findFirst.mockResolvedValue({ id: "owned" });
    prismaMock.property.findFirst.mockResolvedValue({ id: "owned" });
    prismaMock.lease.findFirst.mockResolvedValue({ id: "owned" });
  });

  it("audits GET /api/compliance/rent-receipts", async () => {
    listRentReceiptsMock.mockResolvedValue({ receipts: [], total: 0, page: 1, limit: 50 });

    const request = new NextRequest(
      "http://localhost:3000/api/compliance/rent-receipts?status=draft",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-321",
        action: "VIEW_RENT_RECEIPTS",
        resourceType: "RentReceipt",
      }),
    );
  });

  it("audits POST /api/compliance/rent-receipts including failed creation details", async () => {
    createRentReceiptMock.mockResolvedValue({
      success: false,
      errors: ["Validation failed"],
    });

    const request = new NextRequest("http://localhost:3000/api/compliance/rent-receipts", {
      method: "POST",
      body: JSON.stringify({
        tenantId: "tenant-1",
        propertyId: "property-1",
        landlordNif: "123456789",
        paymentDate: "2026-01-01",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-321",
        action: "CREATE_RENT_RECEIPT",
        resourceType: "RentReceipt",
      }),
    );
  });

  // A receipt is filed against a tenant, a property and optionally a lease, and those ids came from
  // the body unchecked: a caller could file a legal Recibo de Renda — the document the XML for AT
  // is built from — against another landlord's tenant and property.
  describe("POST: the records a receipt is filed against", () => {
    const valid = {
      tenantId: "cjld2cjxh0000qzrmn831i7rn",
      propertyId: "cjld2cyuq0000t3rmniod1foy",
      leaseId: "cjld2d5nl0000u9rmkkm2yj1z",
      landlordNif: "123456789",
      propertyAddress: "Rua Augusta 12, Lisboa",
      rentAmount: 950,
      paymentDate: "2026-03-01T00:00:00.000Z",
      periodStart: "2026-03-01T00:00:00.000Z",
      periodEnd: "2026-03-31T00:00:00.000Z",
    };
    beforeEach(() => {
      // `clearAllMocks` keeps implementations, and the case above leaves a failed creation behind.
      createRentReceiptMock.mockResolvedValue({
        success: true,
        receiptId: "rr-1",
        receiptNumber: "RR-2026-0001",
      });
    });

    const post = () =>
      POST(
        new NextRequest("http://localhost:3000/api/compliance/rent-receipts", {
          method: "POST",
          body: JSON.stringify(valid),
        }),
      );

    it.each([
      ["tenant", prismaMock.tenant],
      ["property", prismaMock.property],
      ["lease", prismaMock.lease],
    ])("refuses a %s the caller does not own", async (_label, model) => {
      model.findFirst.mockResolvedValue(null);

      const response = await post();

      expect(response.status).toBe(404);
      expect(createRentReceiptMock).not.toHaveBeenCalled();
    });

    it("files against records the caller owns", async () => {
      const response = await post();

      expect(response.status).toBe(201);

      expect(prismaMock.tenant.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: valid.tenantId, userId: "user-321" } }),
      );
      expect(createRentReceiptMock).toHaveBeenCalledTimes(1);
    });
  });
});
