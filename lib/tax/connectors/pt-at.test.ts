import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Guards the fail-closed behaviour of the PT connector's mode handling.
 *
 * The danger this pins is the inverse of the obvious one. Test data cannot reach the
 * Autoridade Tributária — nothing in pt-at.ts makes a network call. The risk was that
 * `submit()` and `poll()` ran their simulation REGARDLESS of `connector.mode`: flipping the
 * `mode` column to "live" (an unconstrained String, and the first thing an operator would try
 * when going live) made Situs mark rent receipts `submitted` and then `accepted` with a
 * synthesised AT submission id, having sent nothing. A landlord would believe they had filed.
 *
 * A fabricated acceptance on a fiscal record is worse than a visible failure, which is why
 * these tests assert three separate things and not just "it returns an error":
 *   1. no receipt state is written,
 *   2. an error is returned,
 *   3. the refusal is LOGGED — a silent refusal is its own failure mode, because the operator
 *      who flipped the mode needs to discover why nothing is being submitted.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    rentReceipt: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  },
}));

const { ensureConnectorMock, logSubmissionMock } = vi.hoisted(() => ({
  ensureConnectorMock: vi.fn(),
  logSubmissionMock: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/tax/connector-service", () => ({
  ensureConnector: ensureConnectorMock,
  logSubmission: logSubmissionMock,
}));
vi.mock("@/lib/utils/tax-id-validation", () => ({ validatePortugueseNIF: () => true }));

import { ptAtConnector } from "./pt-at";

const RECEIPT_ID = "rr-1";
const USER_ID = "user-1";

/** A receipt in the one state `submit` accepts, with everything else valid. */
const submittableReceipt = {
  id: RECEIPT_ID,
  userId: USER_ID,
  landlordNif: "123456789",
  tenantNif: "987654321",
  xmlPayload: "<Modelo44/>",
  status: "draft",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.rentReceipt.findUnique.mockResolvedValue(submittableReceipt);
  prismaMock.rentReceipt.findUniqueOrThrow.mockResolvedValue(submittableReceipt);
  prismaMock.rentReceipt.update.mockResolvedValue(submittableReceipt);
  logSubmissionMock.mockResolvedValue(undefined);
});

const withMode = (mode: string) =>
  ensureConnectorMock.mockResolvedValue({ id: "conn-1", mode, userId: USER_ID });

describe("PT connector refuses modes it cannot honour", () => {
  for (const mode of ["live", "Live", "sandbox ", "production", ""]) {
    it(`submit() refuses mode "${mode}" without touching the receipt`, async () => {
      withMode(mode);

      const result = await ptAtConnector.submit(RECEIPT_ID);

      expect(result.status).toBe("error");
      expect(result.responseBody).toMatch(/no live Autoridade Tributária integration/i);
      // The load-bearing assertion: nothing was marked submitted.
      expect(prismaMock.rentReceipt.update).not.toHaveBeenCalled();
    });

    it(`poll() refuses mode "${mode}" without marking the receipt accepted`, async () => {
      withMode(mode);
      prismaMock.rentReceipt.findUniqueOrThrow.mockResolvedValue({
        ...submittableReceipt,
        status: "submitted",
      });

      const result = await ptAtConnector.poll(RECEIPT_ID);

      expect(result.status).toBe("error");
      expect(prismaMock.rentReceipt.update).not.toHaveBeenCalled();
    });
  }

  it("logs the refusal so an operator can find out why nothing was submitted", async () => {
    withMode("live");

    await ptAtConnector.submit(RECEIPT_ID);

    expect(logSubmissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        connectorId: "conn-1",
        subjectId: RECEIPT_ID,
        action: "submit",
        mode: "live",
        status: "error",
      }),
    );
  });
});

describe("PT connector still simulates in the modes it does support", () => {
  it("submit() in review marks the receipt submitted and logs success", async () => {
    withMode("review");

    const result = await ptAtConnector.submit(RECEIPT_ID);

    expect(result.status).toBe("success");
    expect(result.responseCode).toBe("202");
    expect(prismaMock.rentReceipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "submitted" }),
      }),
    );
  });

  it("submit() in sandbox behaves the same as review", async () => {
    withMode("sandbox");

    const result = await ptAtConnector.submit(RECEIPT_ID);

    expect(result.status).toBe("success");
    expect(prismaMock.rentReceipt.update).toHaveBeenCalled();
  });

  it("poll() in review resolves a submitted receipt to accepted", async () => {
    withMode("review");
    prismaMock.rentReceipt.findUniqueOrThrow.mockResolvedValue({
      ...submittableReceipt,
      status: "submitted",
    });

    const result = await ptAtConnector.poll(RECEIPT_ID);

    expect(result.status).toBe("success");
    expect(prismaMock.rentReceipt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "accepted" }) }),
    );
  });
});
