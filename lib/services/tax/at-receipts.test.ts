// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Receipts and Finanças, month by month: what the review shows, and what a test sends to AT's
 * test service. AT's answers come from a mocked client here; the request itself is proved against
 * a stand-in for AT in lib/tax/at/client.test.ts.
 */

const { prismaMock, logAuditMock, emitirReciboMock, connection } = vi.hoisted(() => ({
  prismaMock: {
    receipt: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    paymentAllocation: { findMany: vi.fn() },
    lease: { findMany: vi.fn() },
    propertyOwner: { findMany: vi.fn() },
    owner: { findMany: vi.fn() },
    tenant: { findMany: vi.fn() },
    leaseParty: { findMany: vi.fn() },
    rentReceipt: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
  logAuditMock: vi.fn(),
  emitirReciboMock: vi.fn(),
  connection: {
    getAtConnection: vi.fn(),
    prepareCall: vi.fn(),
    logCall: vi.fn(),
  },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/tax/at/client", () => ({ emitirRecibo: emitirReciboMock }));
vi.mock("./at-connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./at-connection")>()),
  ...connection,
}));

import { ConflictError } from "@/lib/utils/error-handling";
import { UNREADABLE_PII } from "@/lib/utils/pii-encryption";
import { MAX_TEST_MONTHS } from "@/lib/tax/at/receipt-request";
import { previewAtReceipts, testAtReceipts } from "./at-receipts";

const USER = "owner-1";
const NOW = new Date("2026-09-27T10:00:00Z");
const CONNECTOR = { id: "conn-1", mode: "test" };

function receipt(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    date: new Date("2026-09-03T00:00:00Z"),
    type: "rent",
    status: "paid",
    lifecycle: "draft",
    ...overrides,
  };
}

function allocation(receiptId: string, periodId: string, month: number, amount: number) {
  return {
    receiptId,
    amount,
    rentPeriod: { id: periodId, year: 2026, month, leaseId: "lease-1" },
  };
}

const answer = (code: number, extra: Record<string, unknown> = {}) => ({
  outcome: "answer",
  operation: "emitirReciboResponse",
  code,
  category: code === 0 ? "ok" : code === -1 ? "rejected" : code === 99 ? "password" : "unknown",
  message: code === 0 ? "Documento registado com sucesso" : "Erro",
  errors: [],
  ...extra,
});

beforeEach(() => {
  // Reset, not clear: a test that queues AT's answers must not leave one for the next.
  vi.resetAllMocks();
  prismaMock.receipt.findMany.mockResolvedValue([receipt("rcpt-1")]);
  prismaMock.paymentAllocation.findMany.mockResolvedValue([
    allocation("rcpt-1", "period-9", 9, 700),
    allocation("rcpt-1", "period-9", 9, 50),
  ]);
  prismaMock.lease.findMany.mockResolvedValue([
    {
      id: "lease-1",
      tenantId: "tenant-1",
      propertyId: "property-1",
      atContractNumber: "1234567",
      atContractVersion: 2,
    },
  ]);
  prismaMock.propertyOwner.findMany.mockResolvedValue([
    { propertyId: "property-1", ownerId: "owner-a" },
  ]);
  prismaMock.owner.findMany.mockResolvedValue([
    { id: "owner-a", name: "Ana Senhoria", taxIdentificationNumber: "123456789" },
  ]);
  prismaMock.tenant.findMany.mockResolvedValue([
    {
      id: "tenant-1",
      name: "Rui Inquilino",
      taxId: "234567899",
      taxCountry: "PT",
      idDocument: null,
    },
  ]);
  prismaMock.leaseParty.findMany.mockResolvedValue([
    {
      id: "party-1",
      leaseId: "lease-1",
      role: "tenant",
      name: "Marie Colocataire",
      taxId: null,
      taxCountry: "FR",
      idDocument: "12AB34567",
    },
    {
      id: "party-2",
      leaseId: "lease-1",
      role: "guarantor",
      name: "Fiador Garante",
      taxId: "451234561",
      taxCountry: "PT",
      idDocument: null,
    },
  ]);
  connection.getAtConnection.mockResolvedValue({
    mode: "test",
    username: "555555555/1",
    passwordSet: true,
    credentialsUnreadable: false,
    files: { ready: true, files: {} },
  });
  connection.prepareCall.mockResolvedValue({
    connector: CONNECTOR,
    context: { endpoint: "https://at.test", login: { username: "555555555/1", password: "x" } },
  });
  emitirReciboMock.mockResolvedValue(answer(0, { receiptNumber: 42 }));
});

describe("previewAtReceipts", () => {
  it("shows, for each month, the contract, the landlords, the tenants and what the receipt paid", async () => {
    const preview = await previewAtReceipts(USER, ["rcpt-1"], NOW);

    expect(preview).toEqual({
      mode: "test",
      canTest: true,
      receipts: [
        {
          receiptId: "rcpt-1",
          refusal: null,
          months: [
            {
              periodId: "period-9",
              year: 2026,
              month: 9,
              amount: 750,
              receivedOn: "2026-09-03",
              contractNumber: "1234567",
              contractVersion: 2,
              landlords: [{ name: "Ana Senhoria", nif: "123456789" }],
              // The co-tenant is on it; the guarantor never is.
              tenants: [
                { name: "Rui Inquilino", nif: "234567899", country: "PT", document: null },
                { name: "Marie Colocataire", nif: null, country: "FR", document: "12AB34567" },
              ],
              blockers: [],
            },
          ],
        },
      ],
    });
  });

  it("reads only the owner's own records, and the people through their own models", async () => {
    await previewAtReceipts(USER, ["rcpt-1", "rcpt-1"], NOW);

    const where = (mock: { findMany: ReturnType<typeof vi.fn> }) =>
      mock.findMany.mock.calls[0][0].where;
    expect(where(prismaMock.receipt)).toEqual({ userId: USER, id: { in: ["rcpt-1"] } });
    expect(where(prismaMock.paymentAllocation)).toEqual({
      userId: USER,
      receiptId: { in: ["rcpt-1"] },
      reversedAt: null,
    });
    expect(where(prismaMock.lease)).toMatchObject({ userId: USER });
    expect(where(prismaMock.propertyOwner)).toMatchObject({ property: { userId: USER } });
    expect(where(prismaMock.owner)).toMatchObject({ userId: USER });
    expect(where(prismaMock.tenant)).toMatchObject({ userId: USER });
    expect(where(prismaMock.leaseParty)).toMatchObject({ userId: USER });
  });

  it("says what stops a month, and why a whole receipt cannot go", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([
      receipt("rcpt-1"),
      receipt("rcpt-emitted", { lifecycle: "emitted" }),
      receipt("rcpt-deposit", { type: "deposit" }),
      receipt("rcpt-pending", { status: "pending" }),
      receipt("rcpt-loose"),
    ]);
    prismaMock.paymentAllocation.findMany.mockResolvedValue([
      allocation("rcpt-1", "period-9", 9, 750),
      allocation("rcpt-emitted", "period-8", 8, 750),
      allocation("rcpt-deposit", "period-8", 8, 750),
      allocation("rcpt-pending", "period-8", 8, 750),
    ]);
    prismaMock.lease.findMany.mockResolvedValue([
      {
        id: "lease-1",
        tenantId: "tenant-1",
        propertyId: "property-1",
        atContractNumber: null,
        atContractVersion: null,
      },
    ]);

    const { receipts } = await previewAtReceipts(USER, ["x"], NOW);

    expect(receipts.map((entry) => [entry.receiptId, entry.refusal])).toEqual([
      ["rcpt-1", null],
      ["rcpt-emitted", "not_issuable"],
      ["rcpt-deposit", "not_rent"],
      ["rcpt-pending", "not_paid"],
      ["rcpt-loose", "no_rent_month"],
    ]);
    expect(receipts[0].months[0].blockers).toEqual([{ code: "contract_number_missing" }]);
  });

  it("treats a NIF or a document it could not decrypt as missing, and sends none of it", async () => {
    // After the key changed the extension answers UNREADABLE_PII, which is not empty: a foreign
    // tenant's document would pass, and the sentinel would go to AT as a document number.
    prismaMock.owner.findMany.mockResolvedValue([
      { id: "owner-a", name: "Ana Senhoria", taxIdentificationNumber: UNREADABLE_PII },
    ]);
    prismaMock.tenant.findMany.mockResolvedValue([
      {
        id: "tenant-1",
        name: "Rui Inquilino",
        taxId: null,
        taxCountry: "ES",
        idDocument: UNREADABLE_PII,
      },
    ]);
    prismaMock.leaseParty.findMany.mockResolvedValue([
      {
        id: "party-1",
        leaseId: "lease-1",
        role: "tenant",
        name: "Marie Colocataire",
        taxId: null,
        taxCountry: "FR",
        idDocument: UNREADABLE_PII,
      },
    ]);

    const { receipts } = await previewAtReceipts(USER, ["rcpt-1"], NOW);
    const [month] = receipts[0].months;

    expect(month.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(["landlord_nif_missing", "tenant_document_missing"]),
    );
    expect(JSON.stringify(receipts)).not.toContain(UNREADABLE_PII);
  });

  it("lists a receipt's months in order, one per month however many allocations it holds", async () => {
    prismaMock.paymentAllocation.findMany.mockResolvedValue([
      allocation("rcpt-1", "period-10", 10, 100),
      allocation("rcpt-1", "period-8", 8, 750),
      allocation("rcpt-1", "period-10", 10, 0.1),
      allocation("rcpt-1", "period-10", 10, 0.2),
    ]);

    const { receipts } = await previewAtReceipts(USER, ["rcpt-1"], NOW);

    expect(receipts[0].months.map((month) => [month.month, month.amount])).toEqual([
      [8, 750],
      [10, 100.3],
    ]);
  });

  it("offers a test only in the test mode, with a login and the files", async () => {
    const canTest = async (view: Record<string, unknown>) => {
      connection.getAtConnection.mockResolvedValue({
        mode: "test",
        passwordSet: true,
        files: { ready: true },
        ...view,
      });
      return (await previewAtReceipts(USER, ["rcpt-1"], NOW)).canTest;
    };

    expect(await canTest({})).toBe(true);
    expect(await canTest({ mode: "review" })).toBe(false);
    expect(await canTest({ passwordSet: false })).toBe(false);
    expect(await canTest({ files: { ready: false } })).toBe(false);
  });
});

describe("testAtReceipts", () => {
  it("sends each ready month to AT's test service, as the Portal user's NIF, and returns AT's number", async () => {
    const result = await testAtReceipts(USER, ["rcpt-1"], NOW);

    expect(emitirReciboMock).toHaveBeenCalledTimes(1);
    const [context, fields] = emitirReciboMock.mock.calls[0];
    expect(context).toMatchObject({ endpoint: "https://at.test" });
    expect(fields).toMatchObject({
      numeroContrato: "1234567",
      versaoContrato: 2,
      nifEmitente: "555555555",
      locadores: [{ nif: "123456789" }],
      locatarios: [
        { nif: "234567899", pais: "PT" },
        { docIdentificacao: "12AB34567", pais: "FR" },
      ],
      dataInicio: "2026-09-01",
      dataFim: "2026-09-30",
      valor: "750.00",
      dataRecebimento: "2026-09-03",
    });
    expect(JSON.stringify(fields)).not.toContain("451234561");
    expect(result).toEqual([
      {
        receiptId: "rcpt-1",
        refusal: null,
        months: [
          {
            periodId: "period-9",
            year: 2026,
            month: 9,
            status: "sent",
            receiptNumber: 42,
            call: {
              outcome: "answer",
              code: 0,
              category: "ok",
              message: "Documento registado com sucesso",
              errors: [],
            },
          },
        ],
      },
    ]);
  });

  it("logs each month sent, and records the test in the audit trail without anyone's NIF", async () => {
    await testAtReceipts(USER, ["rcpt-1"], NOW);

    expect(connection.logCall).toHaveBeenCalledWith(
      USER,
      CONNECTOR,
      { subjectType: "receipt", subjectId: "rcpt-1/2026-09", action: "submit" },
      expect.objectContaining({ code: 0 }),
      true,
    );
    expect(logAuditMock).toHaveBeenCalledWith({
      userId: USER,
      action: "TEST_AT_RECEIPT",
      resourceType: "receipt",
      resourceId: "rcpt-1",
      details: { months: [{ month: "2026-09", outcome: "answer", code: 0 }] },
    });
    expect(JSON.stringify(logAuditMock.mock.calls)).not.toMatch(/123456789|234567899|12AB34567/);
  });

  it("records nothing on the receipt: a receipt AT's test service issued does not count", async () => {
    await testAtReceipts(USER, ["rcpt-1"], NOW);

    expect(prismaMock.receipt.update).not.toHaveBeenCalled();
    expect(prismaMock.receipt.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.rentReceipt.create).not.toHaveBeenCalled();
    expect(prismaMock.rentReceipt.update).not.toHaveBeenCalled();
    expect(prismaMock.rentReceipt.updateMany).not.toHaveBeenCalled();
  });

  it("sends nothing for a blocked month or a refused receipt, and says why", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([
      receipt("rcpt-1"),
      receipt("rcpt-emitted", { lifecycle: "emitted" }),
    ]);
    prismaMock.paymentAllocation.findMany.mockResolvedValue([
      allocation("rcpt-1", "period-9", 9, 750),
      allocation("rcpt-emitted", "period-8", 8, 750),
    ]);
    prismaMock.owner.findMany.mockResolvedValue([
      { id: "owner-a", name: "Ana Senhoria", taxIdentificationNumber: null },
    ]);

    const result = await testAtReceipts(USER, ["rcpt-1", "rcpt-emitted"], NOW);

    expect(emitirReciboMock).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        receiptId: "rcpt-1",
        refusal: null,
        months: [
          {
            periodId: "period-9",
            year: 2026,
            month: 9,
            status: "blocked",
            blockers: [{ code: "landlord_nif_missing", name: "Ana Senhoria" }],
          },
        ],
      },
      { receiptId: "rcpt-emitted", refusal: "not_issuable", months: [] },
    ]);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("goes on after AT refuses one month, and stops after a refused login", async () => {
    prismaMock.paymentAllocation.findMany.mockResolvedValue([
      allocation("rcpt-1", "period-7", 7, 750),
      allocation("rcpt-1", "period-8", 8, 750),
      allocation("rcpt-1", "period-9", 9, 750),
    ]);
    emitirReciboMock
      .mockResolvedValueOnce(
        answer(-1, { errors: [{ field: "valor", message: "Valor inválido" }] }),
      )
      .mockResolvedValueOnce(answer(99))
      .mockResolvedValue(answer(0, { receiptNumber: 43 }));

    const [entry] = await testAtReceipts(USER, ["rcpt-1"], NOW);

    // Repeating a refused password can suspend the Portal user, so the third month never goes.
    expect(emitirReciboMock).toHaveBeenCalledTimes(2);
    expect(entry.months.map((month) => month.status)).toEqual(["sent", "sent", "skipped"]);
    expect(entry.months[0]).toMatchObject({
      call: { category: "rejected", errors: [{ field: "valor", message: "Valor inválido" }] },
      receiptNumber: null,
    });
  });

  it("stops after a call that never reached AT, or got no answer", async () => {
    prismaMock.paymentAllocation.findMany.mockResolvedValue([
      allocation("rcpt-1", "period-8", 8, 750),
      allocation("rcpt-1", "period-9", 9, 750),
    ]);
    emitirReciboMock.mockResolvedValueOnce({
      outcome: "unknown",
      reason: "no answer within 30000 ms",
    });

    const [entry] = await testAtReceipts(USER, ["rcpt-1"], NOW);

    expect(emitirReciboMock).toHaveBeenCalledTimes(1);
    expect(entry.months.map((month) => month.status)).toEqual(["sent", "skipped"]);
    expect(entry.months[0]).toMatchObject({ call: { outcome: "unknown" } });
  });

  it(`sends at most ${MAX_TEST_MONTHS} months in one test`, async () => {
    prismaMock.paymentAllocation.findMany.mockResolvedValue(
      Array.from({ length: 14 }, (_, index) => ({
        receiptId: "rcpt-1",
        amount: 750,
        rentPeriod: {
          id: `period-${index}`,
          year: 2025 + Math.floor(index / 12),
          month: (index % 12) + 1,
          leaseId: "lease-1",
        },
      })),
    );

    const [entry] = await testAtReceipts(USER, ["rcpt-1"], NOW);

    expect(emitirReciboMock).toHaveBeenCalledTimes(MAX_TEST_MONTHS);
    expect(entry.months.filter((month) => month.status === "skipped")).toHaveLength(2);
  });

  it("sends nothing outside the test mode, and passes the refusal on", async () => {
    connection.prepareCall.mockRejectedValue(
      new ConflictError("The connector is not in the test mode", "at_test_mode_required"),
    );

    await expect(testAtReceipts(USER, ["rcpt-1"], NOW)).rejects.toMatchObject({
      reason: "at_test_mode_required",
    });
    expect(emitirReciboMock).not.toHaveBeenCalled();
    expect(prismaMock.receipt.findMany).not.toHaveBeenCalled();
  });
});
