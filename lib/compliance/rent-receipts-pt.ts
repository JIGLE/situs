/**
 * Recibos de Renda Eletrónicos — Portugal
 *
 * Mandatory electronic rent receipt generation per Portuguese law.
 * Landlords must issue a receipt within 5 days of receiving rent.
 *
 * This module generates the receipt data, PDF, and XML payload
 * for submission to the Autoridade Tributária (AT) via Portal das Finanças.
 *
 * @see Decreto-Lei n.º 442-A/88 (Código do IRS, Art. 115.º)
 * @see Portaria n.º 98-A/2015 (Modelo 44 — Recibos de Renda)
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { validatePortugueseNIF } from "@/lib/utils/tax-id-validation";

// ─── Receipt numbering ─────────────────────────────────────────────────
// Format: RR/YYYY/NNNNNN (e.g. RR/2026/000001)

export async function generateReceiptNumber(userId: string): Promise<string> {
  const prisma = getPrismaClient();
  const year = new Date().getFullYear();
  const prefix = `RR/${year}/`;

  // Count existing receipts for this user in the current year
  const count = await prisma.rentReceipt.count({
    where: {
      userId,
      receiptNumber: { startsWith: prefix },
    },
  });

  const seq = (count + 1).toString().padStart(6, "0");
  return `${prefix}${seq}`;
}

// ─── Interfaces ─────────────────────────────────────────────────────────

export interface RentReceiptInput {
  userId: string;
  tenantId: string;
  propertyId: string;
  leaseId?: string;
  landlordNif: string;
  tenantNif?: string;
  propertyAddress: string;
  cadasterReference?: string;
  rentAmount: number;
  withholdingRate?: number; // e.g. 0.25 for 25% withholding
  paymentDate: Date;
  periodStart: Date;
  periodEnd: Date;
  isRendaAcessivel?: boolean;
}

export interface RentReceiptResult {
  success: boolean;
  receiptId?: string;
  receiptNumber?: string;
  xml?: string;
  errors?: string[];
}

// ─── XML Generation for AT submission ───────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Generate XML payload for Recibo de Renda submission to AT
 * Based on Modelo 44 structure
 */
export function generateReceiptXml(params: {
  receiptNumber: string;
  landlordNif: string;
  tenantNif: string;
  propertyAddress: string;
  cadasterReference?: string;
  rentAmount: number;
  withholdingAmount: number;
  netAmount: number;
  paymentDate: Date;
  periodStart: Date;
  periodEnd: Date;
  isRendaAcessivel: boolean;
  taxRegime: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ReciboRenda xmlns="urn:pt:at:recibo-renda:v1">
  <NumeroRecibo>${escapeXml(params.receiptNumber)}</NumeroRecibo>
  <DadosSenhoriu>
    <NIF>${escapeXml(params.landlordNif)}</NIF>
  </DadosSenhoriu>
  <DadosInquilino>
    <NIF>${escapeXml(params.tenantNif || "999999990")}</NIF>
  </DadosInquilino>
  <DadosImovel>
    <Morada>${escapeXml(params.propertyAddress)}</Morada>
    ${params.cadasterReference ? `<ArtigoMatricial>${escapeXml(params.cadasterReference)}</ArtigoMatricial>` : ""}
  </DadosImovel>
  <DadosRenda>
    <ValorRenda>${params.rentAmount.toFixed(2)}</ValorRenda>
    <RetencaoFonte>${params.withholdingAmount.toFixed(2)}</RetencaoFonte>
    <ValorLiquido>${params.netAmount.toFixed(2)}</ValorLiquido>
    <DataPagamento>${formatDate(params.paymentDate)}</DataPagamento>
    <PeriodoInicio>${formatDate(params.periodStart)}</PeriodoInicio>
    <PeriodoFim>${formatDate(params.periodEnd)}</PeriodoFim>
    <RegimeFiscal>${params.isRendaAcessivel ? "RENDA_ACESSIVEL" : "CATEGORIA_F"}</RegimeFiscal>
  </DadosRenda>
</ReciboRenda>`;
}

// ─── Main receipt creation ──────────────────────────────────────────────

/**
 * Create and persist a Recibo de Renda Eletrónico
 */
export async function createRentReceipt(input: RentReceiptInput): Promise<RentReceiptResult> {
  const prisma = getPrismaClient();
  const errors: string[] = [];

  // Validate landlord NIF
  if (!validatePortugueseNIF(input.landlordNif)) {
    errors.push("NIF do senhorio inválido (invalid landlord NIF)");
  }

  // Validate tenant NIF if provided
  if (input.tenantNif && !validatePortugueseNIF(input.tenantNif)) {
    errors.push("NIF do inquilino inválido (invalid tenant NIF)");
  }

  if (input.rentAmount <= 0) {
    errors.push("Valor da renda deve ser positivo (rent amount must be positive)");
  }

  // Receipt must be issued within 5 days of payment
  const daysSincePayment = Math.floor(
    (Date.now() - input.paymentDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysSincePayment > 5) {
    errors.push(
      `Recibo emitido ${daysSincePayment} dias após pagamento — prazo legal é 5 dias (receipt issued ${daysSincePayment} days after payment — legal deadline is 5 days)`,
    );
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Calculate withholding
  const withholdingRate = input.withholdingRate ?? 0;
  const withholdingAmount = input.rentAmount * withholdingRate;
  const netAmount = input.rentAmount - withholdingAmount;

  // Generate sequential receipt number
  const receiptNumber = await generateReceiptNumber(input.userId);

  const taxRegime = input.isRendaAcessivel ? "renda_acessivel" : "categoria_f";

  // Generate XML for AT
  const xml = generateReceiptXml({
    receiptNumber,
    landlordNif: input.landlordNif,
    tenantNif: input.tenantNif || "999999990",
    propertyAddress: input.propertyAddress,
    cadasterReference: input.cadasterReference,
    rentAmount: input.rentAmount,
    withholdingAmount,
    netAmount,
    paymentDate: input.paymentDate,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    isRendaAcessivel: input.isRendaAcessivel || false,
    taxRegime,
  });

  // Persist receipt in database
  const receipt = await prisma.rentReceipt.create({
    data: {
      userId: input.userId,
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      leaseId: input.leaseId,
      receiptNumber,
      landlordNif: input.landlordNif,
      tenantNif: input.tenantNif,
      propertyAddress: input.propertyAddress,
      cadasterReference: input.cadasterReference,
      rentAmount: input.rentAmount,
      withholdingAmount,
      netAmount,
      paymentDate: input.paymentDate,
      receiptDate: new Date(),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      isRendaAcessivel: input.isRendaAcessivel || false,
      taxRegime,
      status: "draft",
      xmlPayload: xml,
    },
  });

  return {
    success: true,
    receiptId: receipt.id,
    receiptNumber: receipt.receiptNumber,
    xml,
  };
}

/**
 * List rent receipts for a user with filters
 */
export async function listRentReceipts(
  userId: string,
  params?: {
    tenantId?: string;
    propertyId?: string;
    status?: string;
    year?: number;
    page?: number;
    limit?: number;
  },
) {
  const prisma = getPrismaClient();
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 50;

  const where: Record<string, unknown> = { userId };
  if (params?.tenantId) where.tenantId = params.tenantId;
  if (params?.propertyId) where.propertyId = params.propertyId;
  if (params?.status) where.status = params.status;
  if (params?.year) {
    where.paymentDate = {
      gte: new Date(params.year, 0, 1),
      lt: new Date(params.year + 1, 0, 1),
    };
  }

  const [receipts, total] = await Promise.all([
    prisma.rentReceipt.findMany({
      where,
      orderBy: { paymentDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.rentReceipt.count({ where }),
  ]);

  return { receipts, total, page, limit };
}
