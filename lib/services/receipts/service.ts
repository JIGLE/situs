/**
 * Situs receipt lifecycle — Prisma orchestration around the pure state
 * machine (./lifecycle). Owns three side effects the engine deliberately
 * does not know about:
 *  - archive: generating the receipt PDF and filing it as a Document the
 *    moment a receipt reaches "emitted" or "accepted" (idempotent — a
 *    second entry into an archive state never re-files it)
 *  - the PT connector round trip (submit → AT, poll → accepted/rejected)
 *  - reversing live allocations when a receipt is voided, so the reference-
 *    month ledger and derived tenant status regress with it
 */

import type { AuditAction } from "@/lib/services/audit-log";
import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { reverseAllocationsForReceipt } from "@/lib/services/allocation/service";
import { pdfGenerator } from "@/lib/services/pdf-generator";
import { documentService } from "@/lib/services/document-service";
import { ptAtConnector } from "@/lib/tax/connectors/pt-at";
import { evaluateTransition, type ReceiptLifecycleState } from "./lifecycle";

const ARCHIVE_MARKER_PREFIX = "situs-receipt-archive:";

const AUDIT_ACTION_FOR_STATE: Partial<Record<ReceiptLifecycleState, AuditAction>> = {
  emitted: "EMIT_RECEIPT",
  submitted: "SUBMIT_RECEIPT",
  voided: "VOID_RECEIPT",
};

export interface TransitionOptions {
  voidReason?: string;
}

export interface TransitionOutcome {
  lifecycle: ReceiptLifecycleState;
  archived: boolean;
  connector?: { status: string; responseCode?: string; responseBody?: string };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function archiveReceipt(receipt: {
  id: string;
  userId: string;
  tenantId: string;
  propertyId: string;
  amount: number;
  date: Date;
  referenceMonth: string | null;
}): Promise<string> {
  const prisma = getPrismaClient();
  const [tenant, property] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: receipt.tenantId }, select: { name: true } }),
    prisma.property.findUnique({
      where: { id: receipt.propertyId },
      select: { name: true, address: true },
    }),
  ]);

  const tenantName = tenant?.name ?? "—";
  const propertyLabel = [property?.name, property?.address].filter(Boolean).join(" — ") || "—";
  const html = `<!doctype html>
<html>
  <body style="font-family: sans-serif; padding: 24px;">
    <h1>Rent receipt</h1>
    <p><strong>Tenant:</strong> ${escapeHtml(tenantName)}</p>
    <p><strong>Property:</strong> ${escapeHtml(propertyLabel)}</p>
    <p><strong>Reference month:</strong> ${escapeHtml(receipt.referenceMonth ?? "—")}</p>
    <p><strong>Amount:</strong> €${receipt.amount.toFixed(2)}</p>
    <p><strong>Date:</strong> ${receipt.date.toISOString().slice(0, 10)}</p>
  </body>
</html>`;

  const pdf = await pdfGenerator.generateFromHTML(html, `receipt-${receipt.id}.pdf`);

  const document = await documentService.create(receipt.userId, {
    name: `Receipt ${receipt.referenceMonth ?? receipt.date.toISOString().slice(0, 10)} — ${tenantName}`,
    description: `${ARCHIVE_MARKER_PREFIX}${receipt.id}`,
    type: "receipt",
    mimeType: pdf.mimeType,
    fileContent: pdf.buffer,
    propertyId: receipt.propertyId,
    tenantId: receipt.tenantId,
  });

  return document.id;
}

/**
 * Resolve a receipt's archived PDF, if one was ever written.
 *
 * The link is a convention, not a foreign key: `archiveReceiptPdf` writes
 * `${ARCHIVE_MARKER_PREFIX}${receipt.id}` into `Document.description`, and this reads it back.
 * Exported so the API layer resolves it through the same constant rather than rebuilding the
 * marker at a second call site — the marker is the only thing tying a receipt to its proof of
 * emission, and two spellings of it would be two chances to lose that.
 */
export async function findExistingArchive(
  userId: string,
  receiptId: string,
): Promise<string | null> {
  const prisma = getPrismaClient();
  const existing = await prisma.document.findFirst({
    where: { userId, type: "receipt", description: `${ARCHIVE_MARKER_PREFIX}${receiptId}` },
    select: { id: true },
  });
  return existing?.id ?? null;
}

/**
 * Apply a receipt lifecycle transition. Throws on an invalid transition,
 * a failed PT connector call, or a missing prerequisite (e.g. submitting
 * without a linked Modelo 44 filing) — callers surface the message as a
 * 400.
 */
export async function transitionReceipt(
  userId: string,
  receiptId: string,
  to: ReceiptLifecycleState,
  opts: TransitionOptions = {},
): Promise<TransitionOutcome> {
  const prisma = getPrismaClient();
  const receipt = await prisma.receipt.findFirst({ where: { id: receiptId, userId } });
  if (!receipt) throw new Error("Receipt not found");

  const from = receipt.lifecycle;
  const evaluation = evaluateTransition(from, to);
  if (!evaluation.allowed) throw new Error(evaluation.reason ?? "Transition not allowed");

  let connectorResult: TransitionOutcome["connector"];

  if (to === "submitted" || to === "accepted") {
    const filing = await prisma.rentReceipt.findFirst({
      where: { receiptId: receipt.id, userId },
    });

    if (to === "submitted") {
      if (!filing) {
        throw new Error("Link a PT rent receipt (Modelo 44) to this receipt before submitting");
      }
      const result = await ptAtConnector.submit(filing.id);
      if (result.status === "error") throw new Error(result.responseBody ?? "AT submission failed");
      connectorResult = result;
    } else {
      if (!filing) throw new Error("No linked rent receipt to poll");
      const result = await ptAtConnector.poll(filing.id);
      if (result.status === "error") throw new Error(result.responseBody ?? "AT poll failed");
      connectorResult = result;
    }
  }

  let archived = false;
  let archiveDocumentId: string | null = null;
  if (evaluation.archiveTriggered) {
    archiveDocumentId = await findExistingArchive(userId, receipt.id);
    if (!archiveDocumentId) {
      archiveDocumentId = await archiveReceipt(receipt);
      archived = true;
    }
  }

  // The reversal and the lifecycle write must land together. Previously they were two
  // independent writes (the reversal opening its own transaction), so a failure between them
  // on a void left the allocations reversed while the receipt still read "emitted" — the rent
  // period says unpaid and the receipt disagrees, with no way to tell which is right.
  //
  // reverseAllocationsForReceipt takes our `tx` and joins this transaction rather than opening
  // its own, because Prisma cannot nest transactions.
  //
  // The archive above stays outside deliberately: it writes a file and a Document row, is made
  // idempotent by findExistingArchive, and holding a database transaction open across file I/O
  // is its own problem.
  if (to === "voided") {
    await prisma.$transaction(async (tx) => {
      await reverseAllocationsForReceipt(receipt.id, opts.voidReason ?? "Receipt voided", tx);
      await tx.receipt.update({ where: { id: receipt.id }, data: { lifecycle: to } });
    });
  } else {
    await prisma.receipt.update({ where: { id: receipt.id }, data: { lifecycle: to } });
  }

  if (archived && archiveDocumentId) {
    await logAudit({
      userId,
      action: "ARCHIVE_RECEIPT",
      resourceType: "document",
      resourceId: archiveDocumentId,
      details: { receiptId: receipt.id, lifecycle: to },
    });
  }

  await logAudit({
    userId,
    action: AUDIT_ACTION_FOR_STATE[to] ?? "TRANSITION_RECEIPT_LIFECYCLE",
    resourceType: "receipt",
    resourceId: receipt.id,
    details: { from, to, ...connectorResult },
  });

  return { lifecycle: to, archived, connector: connectorResult };
}
