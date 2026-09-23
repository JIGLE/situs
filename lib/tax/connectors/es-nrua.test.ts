import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The point of this file is the first block: **Spain inherits Portugal's fail-closed guard.**
 *
 * The original defect was that pt-at.ts's submit/poll ran their simulation regardless of
 * `connector.mode`, so setting mode to "live" made Situs report receipts as accepted by a tax
 * authority that had received nothing. The guard now lives in ./mode-guard.ts specifically so a
 * second country cannot reintroduce it by re-deriving the rule slightly wrong.
 *
 * These cases exist to prove that sharing actually happened. If someone later inlines a copy of
 * the check into this connector and gets it subtly wrong, the mode table below is what catches
 * it — a fabricated MITMA confirmation is the same class of harm as a fabricated AT one.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    nRUARegistration: { findUnique: vi.fn(), update: vi.fn() },
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

import { esNruaConnector, ES_NRUA_CONNECTOR_KEY } from "./es-nrua";

const REG_ID = "nrua-1";
const USER_ID = "user-1";

/** A registration that passes validateNRUAData: valid NIF, 20-char cadastral ref, rent > 0. */
const validRegistration = {
  id: REG_ID,
  leaseId: "lease-1",
  landlordNif: "12345678Z",
  tenantNif: "87654321X",
  propertyReference: "1234567890123456789A",
  municipalityCode: "28079",
  monthlyRent: 1250,
  contractStartDate: new Date("2026-01-01"),
  contractEndDate: new Date("2027-01-01"),
  contractType: "VIVIENDA_HABITUAL",
  isZonaTensionada: false,
  status: "pending",
  property: { userId: USER_ID, address: "Calle Mayor 1, Madrid", name: "Piso Centro" },
  tenant: { name: "María López" },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.nRUARegistration.findUnique.mockResolvedValue(validRegistration);
  prismaMock.nRUARegistration.update.mockResolvedValue(validRegistration);
  logSubmissionMock.mockResolvedValue(undefined);
});

const withMode = (mode: string) =>
  ensureConnectorMock.mockResolvedValue({ id: "conn-es", mode, userId: USER_ID });

describe("ES connector inherits the shared fail-closed mode guard", () => {
  for (const mode of ["live", "Live", "production", "sandbox ", ""]) {
    it(`submit() refuses mode "${mode}" without touching the registration`, async () => {
      withMode(mode);

      const result = await esNruaConnector.submit(REG_ID);

      expect(result.status).toBe("error");
      expect(result.responseBody).toMatch(/no live MITMA Ventanilla Única integration/i);
      expect(prismaMock.nRUARegistration.update).not.toHaveBeenCalled();
    });

    it(`poll() refuses mode "${mode}" without confirming the registration`, async () => {
      withMode(mode);
      prismaMock.nRUARegistration.findUnique.mockResolvedValue({
        ...validRegistration,
        status: "submitted",
      });

      const result = await esNruaConnector.poll(REG_ID);

      expect(result.status).toBe("error");
      expect(prismaMock.nRUARegistration.update).not.toHaveBeenCalled();
    });
  }

  it("logs the refusal against the ES connector so it is discoverable", async () => {
    withMode("live");

    await esNruaConnector.submit(REG_ID);

    expect(logSubmissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        connectorId: "conn-es",
        subjectType: "nrua",
        subjectId: REG_ID,
        action: "submit",
        mode: "live",
        status: "error",
      }),
    );
  });
});

describe("ES connector simulates in sandbox and review", () => {
  it("submit() moves pending → submitted with a mode-marked registration number", async () => {
    withMode("review");

    const result = await esNruaConnector.submit(REG_ID);

    expect(result.status).toBe("success");
    expect(result.responseCode).toBe("202");
    // The mode is part of the identifier on purpose — a simulated number should be
    // recognisable as one wherever it later surfaces.
    expect(result.responseBody).toMatch(/^REVIEW-NRUA-/);
    expect(prismaMock.nRUARegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "submitted" }) }),
    );
  });

  it("poll() moves submitted → confirmed", async () => {
    withMode("sandbox");
    prismaMock.nRUARegistration.findUnique.mockResolvedValue({
      ...validRegistration,
      status: "submitted",
    });

    const result = await esNruaConnector.poll(REG_ID);

    expect(result.status).toBe("success");
    expect(prismaMock.nRUARegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "confirmed" }) }),
    );
  });
});

describe("ES connector preconditions", () => {
  it("refuses to re-submit a confirmed registration", async () => {
    withMode("review");
    prismaMock.nRUARegistration.findUnique.mockResolvedValue({
      ...validRegistration,
      status: "confirmed",
    });

    const result = await esNruaConnector.submit(REG_ID);

    expect(result.status).toBe("error");
    expect(result.responseBody).toMatch(/NRUA status "confirmed"/);
    expect(prismaMock.nRUARegistration.update).not.toHaveBeenCalled();
  });

  it("surfaces validateNRUAData's errors rather than inventing its own", async () => {
    withMode("review");
    prismaMock.nRUARegistration.findUnique.mockResolvedValue({
      ...validRegistration,
      landlordNif: "not-a-nif",
      propertyReference: "too-short",
    });

    const result = await esNruaConnector.submit(REG_ID);

    expect(result.status).toBe("error");
    expect(result.responseBody).toMatch(/Landlord NIF\/NIE/);
    expect(result.responseBody).toMatch(/referencia catastral/i);
    expect(prismaMock.nRUARegistration.update).not.toHaveBeenCalled();
  });

  it("cannot poll a registration that was never submitted", async () => {
    withMode("review");

    const result = await esNruaConnector.poll(REG_ID);

    expect(result.status).toBe("error");
    expect(result.responseBody).toMatch(/NRUA status "pending"/);
  });

  it("reports a missing registration instead of throwing", async () => {
    withMode("review");
    prismaMock.nRUARegistration.findUnique.mockResolvedValue(null);

    await expect(esNruaConnector.submit("nope")).resolves.toEqual(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("is keyed to MITMA, not the AEAT", () => {
    expect(ES_NRUA_CONNECTOR_KEY).toBe("es_nrua_ventanilla");
    expect(esNruaConnector.country).toBe("ES");
  });
});
