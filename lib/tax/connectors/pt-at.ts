/**
 * Portugal — Recibos de Renda Eletrónicos connector.
 *
 * Wraps lib/compliance/rent-receipts-pt.ts unchanged (numbering, 5-day
 * rule, Modelo 44 XML already generated at RentReceipt creation). This
 * module only owns the submit/poll lifecycle against the Autoridade
 * Tributária and the TaxSubmissionLog trail. There is no live AT endpoint
 * integrated yet (deferred — see plan risk register: "Connector mode
 * locked to Review/Sandbox"), so submit/poll simulate the round trip:
 * sandbox and review both synthesize an acknowledgement rather than call
 * out, and every call is logged exactly as a live call would be.
 *
 * That simulation is opt-in per mode and every other mode fails closed —
 * see ./mode-guard.ts, which every country connector shares so the rule
 * cannot be re-derived (and got wrong) per country. Upgrading to a real
 * integration means writing the endpoint and widening SIMULATED_MODES on
 * purpose; it is deliberately NOT something a `mode` column edit switches on.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { validatePortugueseNIF } from "@/lib/utils/tax-id-validation";
import { ensureConnector, logSubmission } from "@/lib/services/tax/connector-service";
import type { TaxConnector, TaxConnectorResult } from "./types";
import { refuseUnsupportedMode } from "./mode-guard";

export const PT_AT_CONNECTOR_KEY = "pt_at_recibos";

/** Named in the refusal message the operator reads. */
const AUTHORITY = "Autoridade Tributária";

async function validate(rentReceiptId: string): Promise<{ valid: boolean; errors: string[] }> {
  const prisma = getPrismaClient();
  const receipt = await prisma.rentReceipt.findUnique({ where: { id: rentReceiptId } });
  if (!receipt) return { valid: false, errors: ["Rent receipt not found"] };

  const errors: string[] = [];
  if (!validatePortugueseNIF(receipt.landlordNif)) errors.push("Invalid landlord NIF");
  if (receipt.tenantNif && !validatePortugueseNIF(receipt.tenantNif))
    errors.push("Invalid tenant NIF");
  if (!receipt.xmlPayload) errors.push("Missing Modelo 44 XML payload");
  if (receipt.status !== "draft" && receipt.status !== "rejected") {
    errors.push(`Cannot submit a receipt in AT status "${receipt.status}"`);
  }
  return { valid: errors.length === 0, errors };
}

async function submit(rentReceiptId: string): Promise<TaxConnectorResult> {
  const prisma = getPrismaClient();
  const receipt = await prisma.rentReceipt.findUniqueOrThrow({ where: { id: rentReceiptId } });
  const connector = await ensureConnector(receipt.userId, "PT", PT_AT_CONNECTOR_KEY);

  // Before validation, and before any state change — a receipt must not move to "submitted"
  // on a connector whose mode this code cannot honour.
  const refusal = await refuseUnsupportedMode({
    connector,
    userId: receipt.userId,
    subjectType: "rent_receipt",
    subjectId: rentReceiptId,
    action: "submit",
    authority: AUTHORITY,
  });
  if (refusal) return refusal;

  const validation = await validate(rentReceiptId);
  if (!validation.valid) {
    await logSubmission({
      userId: receipt.userId,
      connectorId: connector.id,
      subjectType: "rent_receipt",
      subjectId: rentReceiptId,
      action: "submit",
      mode: connector.mode,
      status: "error",
      responseBody: validation.errors.join("; "),
    });
    return { status: "error", responseBody: validation.errors.join("; ") };
  }

  const submissionId = `${connector.mode.toUpperCase()}-${rentReceiptId.slice(0, 8)}-${Date.now()}`;
  await prisma.rentReceipt.update({
    where: { id: rentReceiptId },
    data: { status: "submitted", atSubmissionId: submissionId, submittedAt: new Date() },
  });

  await logSubmission({
    userId: receipt.userId,
    connectorId: connector.id,
    subjectType: "rent_receipt",
    subjectId: rentReceiptId,
    action: "submit",
    mode: connector.mode,
    status: "success",
    responseCode: "202",
    responseBody: submissionId,
  });

  return { status: "success", responseCode: "202", responseBody: submissionId };
}

async function poll(rentReceiptId: string): Promise<TaxConnectorResult> {
  const prisma = getPrismaClient();
  const receipt = await prisma.rentReceipt.findUniqueOrThrow({ where: { id: rentReceiptId } });
  const connector = await ensureConnector(receipt.userId, "PT", PT_AT_CONNECTOR_KEY);

  // Same guard as submit: without it, poll() unconditionally marked the receipt "accepted".
  const refusal = await refuseUnsupportedMode({
    connector,
    userId: receipt.userId,
    subjectType: "rent_receipt",
    subjectId: rentReceiptId,
    action: "poll",
    authority: AUTHORITY,
  });
  if (refusal) return refusal;

  if (receipt.status !== "submitted") {
    const responseBody = `Cannot poll a receipt in AT status "${receipt.status}"`;
    await logSubmission({
      userId: receipt.userId,
      connectorId: connector.id,
      subjectType: "rent_receipt",
      subjectId: rentReceiptId,
      action: "poll",
      mode: connector.mode,
      status: "error",
      responseBody,
    });
    return { status: "error", responseBody };
  }

  // Sandbox/review connectors auto-accept — there is no live AT endpoint to
  // poll yet.
  await prisma.rentReceipt.update({
    where: { id: rentReceiptId },
    data: { status: "accepted", atResponseCode: "200" },
  });

  await logSubmission({
    userId: receipt.userId,
    connectorId: connector.id,
    subjectType: "rent_receipt",
    subjectId: rentReceiptId,
    action: "poll",
    mode: connector.mode,
    status: "success",
    responseCode: "200",
    responseBody: "accepted",
  });

  return { status: "success", responseCode: "200", responseBody: "accepted" };
}

export const ptAtConnector: TaxConnector = {
  key: PT_AT_CONNECTOR_KEY,
  country: "PT",
  validate,
  submit,
  poll,
};
