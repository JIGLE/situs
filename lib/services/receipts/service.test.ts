import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReceiptFindFirst = vi.fn();
const mockReceiptUpdate = vi.fn();
const mockRentReceiptFindFirst = vi.fn();
const mockDocumentFindFirst = vi.fn();
const mockTenantFindUnique = vi.fn();
const mockPropertyFindUnique = vi.fn();

// The tx handle handed to a `$transaction` callback. Voiding now runs the allocation reversal
// and the lifecycle write inside one transaction, so the mock has to model that: the callback
// receives a client whose `receipt.update` is the same spy, letting the assertions below stay
// agnostic about which handle performed the write.
const mockTxClient = { receipt: { update: mockReceiptUpdate } };
const mockTransaction = vi.fn(async (fn: (tx: typeof mockTxClient) => Promise<unknown>) =>
  fn(mockTxClient),
);

vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => ({
    receipt: { findFirst: mockReceiptFindFirst, update: mockReceiptUpdate },
    rentReceipt: { findFirst: mockRentReceiptFindFirst },
    document: { findFirst: mockDocumentFindFirst },
    tenant: { findUnique: mockTenantFindUnique },
    property: { findUnique: mockPropertyFindUnique },
    $transaction: mockTransaction,
  }),
}));

const mockLogAudit = vi.fn();
vi.mock("@/lib/services/audit-log", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

const mockReverseAllocations = vi.fn().mockResolvedValue(0);
vi.mock("@/lib/services/allocation/service", () => ({
  reverseAllocationsForReceipt: (...args: unknown[]) => mockReverseAllocations(...args),
}));

const mockGenerateFromHTML = vi.fn().mockResolvedValue({
  buffer: Buffer.from("pdf"),
  mimeType: "application/pdf",
  fileName: "r.pdf",
});
vi.mock("@/lib/services/pdf-generator", () => ({
  pdfGenerator: { generateFromHTML: (...args: unknown[]) => mockGenerateFromHTML(...args) },
}));

const mockDocumentCreate = vi.fn().mockResolvedValue({ id: "doc_1" });
vi.mock("@/lib/services/document-service", () => ({
  documentService: { create: (...args: unknown[]) => mockDocumentCreate(...args) },
}));

const mockConnectorSubmit = vi.fn();
const mockConnectorPoll = vi.fn();
vi.mock("@/lib/tax/connectors/pt-at", () => ({
  ptAtConnector: {
    submit: (...args: unknown[]) => mockConnectorSubmit(...args),
    poll: (...args: unknown[]) => mockConnectorPoll(...args),
  },
}));

import { transitionReceipt } from "./service";
import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";

const baseReceipt = {
  id: "receipt_1",
  userId: "user_1",
  tenantId: "tenant_1",
  propertyId: "property_1",
  amount: 850,
  date: new Date("2026-07-01T00:00:00.000Z"),
  referenceMonth: "2026-07",
  lifecycle: "draft",
};

describe("transitionReceipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReceiptFindFirst.mockResolvedValue({ ...baseReceipt });
    mockDocumentFindFirst.mockResolvedValue(null);
    mockTenantFindUnique.mockResolvedValue({ name: "Maria Silva" });
    mockPropertyFindUnique.mockResolvedValue({ name: "Rua Azul 12", address: "Lisboa" });
    mockReverseAllocations.mockResolvedValue(0);
  });

  it("throws when the receipt does not belong to the user", async () => {
    mockReceiptFindFirst.mockResolvedValue(null);
    await expect(transitionReceipt("user_1", "receipt_1", "review")).rejects.toThrow(
      "Receipt not found",
    );
  });

  it("rejects a disallowed transition without mutating anything", async () => {
    await expect(transitionReceipt("user_1", "receipt_1", "accepted")).rejects.toThrow(
      /Cannot move/,
    );
    expect(mockReceiptUpdate).not.toHaveBeenCalled();
  });

  it("moves draft to review with a plain audit entry and no archive", async () => {
    const outcome = await transitionReceipt("user_1", "receipt_1", "review");
    expect(outcome).toEqual({ lifecycle: "review", archived: false, connector: undefined });
    expect(mockReceiptUpdate).toHaveBeenCalledWith({
      where: { id: "receipt_1" },
      data: { lifecycle: "review" },
    });
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TRANSITION_RECEIPT_LIFECYCLE" }),
    );
  });

  it("archives on emit and logs EMIT_RECEIPT + ARCHIVE_RECEIPT", async () => {
    const outcome = await transitionReceipt("user_1", "receipt_1", "emitted");
    expect(outcome.archived).toBe(true);
    expect(mockGenerateFromHTML).toHaveBeenCalledTimes(1);
    expect(mockDocumentCreate).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ type: "receipt", description: "situs-receipt-archive:receipt_1" }),
    );
    const actions = mockLogAudit.mock.calls.map((call) => call[0].action);
    expect(actions).toContain("ARCHIVE_RECEIPT");
    expect(actions).toContain("EMIT_RECEIPT");
  });

  it("does not re-archive when a document for this receipt already exists", async () => {
    mockDocumentFindFirst.mockResolvedValue({ id: "doc_existing" });
    const outcome = await transitionReceipt("user_1", "receipt_1", "emitted");
    expect(outcome.archived).toBe(false);
    expect(mockGenerateFromHTML).not.toHaveBeenCalled();
    expect(mockLogAudit.mock.calls.map((c) => c[0].action)).not.toContain("ARCHIVE_RECEIPT");
  });

  it("submitting requires a linked PT rent receipt filing", async () => {
    mockReceiptFindFirst.mockResolvedValue({ ...baseReceipt, lifecycle: "emitted" });
    mockRentReceiptFindFirst.mockResolvedValue(null);
    await expect(transitionReceipt("user_1", "receipt_1", "submitted")).rejects.toThrow(
      /Link a PT rent receipt/,
    );
    expect(mockConnectorSubmit).not.toHaveBeenCalled();
  });

  it("submits via the PT connector when a filing is linked", async () => {
    mockReceiptFindFirst.mockResolvedValue({ ...baseReceipt, lifecycle: "emitted" });
    mockRentReceiptFindFirst.mockResolvedValue({ id: "rr_1" });
    mockConnectorSubmit.mockResolvedValue({ status: "success", responseCode: "202" });
    const outcome = await transitionReceipt("user_1", "receipt_1", "submitted");
    expect(mockConnectorSubmit).toHaveBeenCalledWith("rr_1");
    expect(outcome.connector).toEqual({ status: "success", responseCode: "202" });
  });

  it("surfaces a connector error as a thrown error and does not update lifecycle", async () => {
    mockReceiptFindFirst.mockResolvedValue({ ...baseReceipt, lifecycle: "emitted" });
    mockRentReceiptFindFirst.mockResolvedValue({ id: "rr_1" });
    mockConnectorSubmit.mockResolvedValue({ status: "error", responseBody: "Invalid NIF" });
    await expect(transitionReceipt("user_1", "receipt_1", "submitted")).rejects.toThrow(
      "Invalid NIF",
    );
    expect(mockReceiptUpdate).not.toHaveBeenCalled();
  });

  it("voiding reverses live allocations and logs VOID_RECEIPT", async () => {
    mockReceiptFindFirst.mockResolvedValue({ ...baseReceipt, lifecycle: "draft" });
    await transitionReceipt("user_1", "receipt_1", "voided", { voidReason: "duplicate payment" });
    expect(mockReverseAllocations).toHaveBeenCalledWith(
      "receipt_1",
      "duplicate payment",
      mockTxClient,
    );
    expect(mockLogAudit.mock.calls.map((c) => c[0].action)).toContain("VOID_RECEIPT");
  });

  // The reversal and the lifecycle write used to be two independent writes, so a failure
  // between them left the allocations reversed while the receipt still read "emitted" — the
  // rent period says unpaid and the receipt disagrees. These pin the boundary itself, not just
  // that both happened.
  it("voiding runs the reversal and the lifecycle write inside ONE transaction", async () => {
    mockReceiptFindFirst.mockResolvedValue({ ...baseReceipt, lifecycle: "draft" });

    await transitionReceipt("user_1", "receipt_1", "voided", { voidReason: "duplicate payment" });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // The reversal is handed the caller's tx rather than opening its own — Prisma cannot nest.
    expect(mockReverseAllocations.mock.calls[0][2]).toBe(mockTxClient);
    // And the lifecycle write went through that same tx handle.
    expect(mockReceiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lifecycle: "voided" } }),
    );
  });

  it("a failing reversal aborts the transaction and leaves the lifecycle unchanged", async () => {
    mockReceiptFindFirst.mockResolvedValue({ ...baseReceipt, lifecycle: "emitted" });
    mockReverseAllocations.mockRejectedValueOnce(new Error("ledger write failed"));

    await expect(
      transitionReceipt("user_1", "receipt_1", "voided", { voidReason: "oops" }),
    ).rejects.toThrow("ledger write failed");

    // The whole point: no half-applied state. The receipt must not read "voided".
    expect(mockReceiptUpdate).not.toHaveBeenCalled();
  });

  it("non-void transitions do not open a transaction", async () => {
    mockReceiptFindFirst.mockResolvedValue({ ...baseReceipt, lifecycle: "draft" });

    await transitionReceipt("user_1", "receipt_1", "review");

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockReceiptUpdate).toHaveBeenCalled();
  });
});

/**
 * Each refusal names its rule, so the route answers it with its own status and the screen can say
 * what refused in the owner's language. The route used to turn every one into a generic 400.
 */
describe("transitionReceipt: refusals are typed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReceiptFindFirst.mockResolvedValue({ ...baseReceipt });
    mockDocumentFindFirst.mockResolvedValue(null);
  });

  const reasonOf = (error: unknown) => (error as ConflictError).reason;

  it("reads another owner's receipt, or none, as not found", async () => {
    mockReceiptFindFirst.mockResolvedValue(null);

    await expect(transitionReceipt("user_1", "receipt_1", "review")).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it("refuses a move the state machine does not allow, naming the rule", async () => {
    const error = await transitionReceipt("user_1", "receipt_1", "accepted").catch((e) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect(reasonOf(error)).toBe("receipt_transition_not_allowed");
  });

  it("refuses to submit without a filing, naming the rule", async () => {
    mockReceiptFindFirst.mockResolvedValue({ ...baseReceipt, lifecycle: "emitted" });
    mockRentReceiptFindFirst.mockResolvedValue(null);

    const error = await transitionReceipt("user_1", "receipt_1", "submitted").catch((e) => e);

    expect(reasonOf(error)).toBe("receipt_filing_missing");
  });

  it("passes a refusal from the connector on as one", async () => {
    mockReceiptFindFirst.mockResolvedValue({ ...baseReceipt, lifecycle: "emitted" });
    mockRentReceiptFindFirst.mockResolvedValue({ id: "rr_1" });
    mockConnectorSubmit.mockResolvedValue({ status: "error", responseBody: "Invalid NIF" });

    const error = await transitionReceipt("user_1", "receipt_1", "submitted").catch((e) => e);

    expect(reasonOf(error)).toBe("receipt_submission_refused");
  });
});
