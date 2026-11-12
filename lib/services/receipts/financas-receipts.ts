/**
 * Recibos de renda uploaded from the Portal das Finanças, put on the rent ledger.
 *
 * A recibo says which contract's month was paid, how much and when. Uploading one does one of
 * three things to that month:
 *  - **create**: nothing paid it yet, so the recibo is the payment: a paid, emitted receipt that
 *    fills that month first (`referenceMonth`, the engine's `startAt`), not the oldest open one.
 *  - **attach**: a payment is already on the month (a bank movement or one recorded by hand), so
 *    no money is added: those receipts take the recibo's number, and a draft from the bank is
 *    marked emitted, which is what issuing the recibo on the Portal means.
 *  - **duplicate**: this recibo number is already on the contract, so nothing changes.
 *
 * Either way the uploaded PDF becomes the receipt's archive (`findExistingArchive`), so the
 * Receipts list serves the recibo itself. `Receipt.financasNumber` set is what the matrix shows
 * as "recibo on file", the darker of its two greens.
 *
 * A month the owner waived (before they started tracking) comes back on the ledger when a recibo
 * for it is uploaded: it says that month was paid. A month the contract has no row for (before it
 * began, or past its end) is refused, since there is nothing on the ledger for it to pay.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { partiesByLease } from "@/lib/services/database/lease-parties";
import { allocateReceipt } from "@/lib/services/allocation/service";
import { logAudit } from "@/lib/services/audit-log";
import { documentService } from "@/lib/services/document-service";
import { ARCHIVE_MARKER_PREFIX, transitionReceipt } from "@/lib/services/receipts/service";
import type { ParsedRentReceipt } from "@/lib/services/financas-import/rent-receipt";
import {
  leasesForReceipt,
  receiptMonth,
  type ReceiptMatchLease,
  type ReceiptMonth,
} from "@/lib/services/financas-import/receipt-match";
import { readablePII } from "@/lib/utils/pii-encryption";
import { MONEY_EPSILON } from "@/lib/utils/money";
import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";

export type ReceiptUploadOutcome = "create" | "attach" | "duplicate" | "no_month";

export interface ReceiptLeaseOption {
  leaseId: string;
  tenantName: string;
  propertyName: string;
  monthlyRent: number;
}

export interface ReceiptProposal {
  /** The contract it pays, when only one fits. */
  leaseId: string | null;
  /** The contracts it may pay, best first; empty when no tenant's NIF on it is known. */
  candidates: ReceiptLeaseOption[];
  month: ReceiptMonth | null;
  /** What uploading it would do, for the proposed contract and month. */
  outcome: ReceiptUploadOutcome | null;
  /** The month's rent, when it differs from the recibo's. */
  dueAmount: number | null;
}

interface LeaseRow extends ReceiptMatchLease {
  option: ReceiptLeaseOption;
}

const monthKey = ({ year, month }: ReceiptMonth) => `${year}-${String(month).padStart(2, "0")}`;

/** The owner's leases (drafts aside), with every tenant's NIF read through its own model. */
async function matchableLeases(userId: string): Promise<LeaseRow[]> {
  const prisma = getPrismaClient();
  const leases = await prisma.lease.findMany({
    where: { userId, status: { not: "draft" } },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      monthlyRent: true,
      tenantId: true,
      propertyId: true,
    },
  });
  if (leases.length === 0) return [];
  const [tenants, properties, parties] = await Promise.all([
    prisma.tenant.findMany({
      where: { userId, id: { in: [...new Set(leases.map((l) => l.tenantId))] } },
      select: { id: true, name: true, taxId: true },
    }),
    prisma.property.findMany({
      where: { userId, id: { in: [...new Set(leases.map((l) => l.propertyId))] } },
      select: { id: true, name: true, cadasterReference: true, fraction: true },
    }),
    partiesByLease(
      userId,
      leases.map((l) => l.id),
    ),
  ]);
  const tenantById = new Map(tenants.map((t) => [t.id, t]));
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  return leases.flatMap((lease) => {
    const tenant = tenantById.get(lease.tenantId);
    const property = propertyById.get(lease.propertyId);
    if (!tenant || !property) return [];
    const coTenants = (parties.get(lease.id) ?? []).filter((p) => p.role === "tenant");
    const tenantTaxIds = [readablePII(tenant.taxId), ...coTenants.map((p) => p.taxId ?? null)]
      .map((taxId) => readablePII(taxId))
      .filter((taxId): taxId is string => Boolean(taxId));
    return [
      {
        id: lease.id,
        status: lease.status,
        startDate: lease.startDate.toISOString(),
        endDate: lease.endDate.toISOString(),
        tenantTaxIds,
        article: property.cadasterReference,
        fraction: property.fraction,
        option: {
          leaseId: lease.id,
          tenantName: tenant.name,
          propertyName: property.name,
          monthlyRent: lease.monthlyRent,
        },
      },
    ];
  });
}

interface MonthState {
  outcome: ReceiptUploadOutcome;
  periodId: string | null;
  dueAmount: number | null;
  waived: boolean;
  /** The receipts already paying the month that have no recibo yet. */
  unnumbered: { id: string; lifecycle: string }[];
}

/** What a recibo would do to one lease's month. */
async function monthState(
  userId: string,
  leaseId: string,
  month: ReceiptMonth,
  number: string | null,
): Promise<MonthState> {
  const prisma = getPrismaClient();
  if (number) {
    const same = await prisma.receipt.findFirst({
      where: { userId, leaseId, financasNumber: number, lifecycle: { not: "voided" } },
      select: { id: true },
    });
    if (same) {
      return {
        outcome: "duplicate",
        periodId: null,
        dueAmount: null,
        waived: false,
        unnumbered: [],
      };
    }
  }
  const period = await prisma.rentPeriod.findFirst({
    where: { userId, leaseId, year: month.year, month: month.month },
    select: { id: true, status: true, dueAmount: true },
  });
  if (!period) {
    return { outcome: "no_month", periodId: null, dueAmount: null, waived: false, unnumbered: [] };
  }
  const allocations = await prisma.paymentAllocation.findMany({
    where: { userId, rentPeriodId: period.id, reversedAt: null },
    select: { receipt: { select: { id: true, lifecycle: true, financasNumber: true } } },
  });
  const paying = allocations.flatMap((a) =>
    a.receipt && a.receipt.lifecycle !== "voided" ? [a.receipt] : [],
  );
  const base = {
    periodId: period.id,
    dueAmount: period.dueAmount,
    waived: period.status === "waived",
  };
  if (paying.length === 0) return { ...base, outcome: "create", unnumbered: [] };
  const unnumbered = [
    ...new Map(paying.filter((r) => !r.financasNumber).map((r) => [r.id, r])).values(),
  ].map(({ id, lifecycle }) => ({ id, lifecycle }));
  // Paid, and every payment already has its recibo: this one is another copy of it.
  if (unnumbered.length === 0) return { ...base, outcome: "duplicate", unnumbered };
  return { ...base, outcome: "attach", unnumbered };
}

/** Which contract and month an uploaded recibo pays, and what uploading it would do. */
export async function proposeReceipt(
  userId: string,
  parsed: ParsedRentReceipt,
): Promise<ReceiptProposal> {
  const leases = await matchableLeases(userId);
  const found = leasesForReceipt(parsed, leases);
  const month = receiptMonth(parsed);
  const leaseId = found.length === 1 ? found[0].id : null;
  const state = leaseId && month ? await monthState(userId, leaseId, month, parsed.number) : null;
  const due = state?.dueAmount ?? null;
  return {
    leaseId,
    candidates: found.map((lease) => lease.option),
    month,
    outcome: state?.outcome ?? null,
    dueAmount:
      due !== null && parsed.rent !== null && Math.abs(due - parsed.rent) > MONEY_EPSILON
        ? due
        : null,
  };
}

export interface RegisterReceiptInput {
  leaseId: string;
  month: ReceiptMonth;
  parsed: ParsedRentReceipt;
  /** The recibo itself, kept as the receipt's archive. */
  pdf: Buffer;
  fileName: string;
}

export interface RegisterReceiptResult {
  outcome: Exclude<ReceiptUploadOutcome, "no_month">;
  receiptIds: string[];
}

/** Put an uploaded recibo on the ledger, for the contract and month the owner confirmed. */
export async function registerReceipt(
  userId: string,
  input: RegisterReceiptInput,
  now: Date = new Date(),
): Promise<RegisterReceiptResult> {
  const prisma = getPrismaClient();
  const lease = await prisma.lease.findFirst({
    where: { id: input.leaseId, userId },
    select: { id: true, tenantId: true, propertyId: true },
  });
  if (!lease) throw new ResourceNotFoundError("Lease");

  const { parsed, month } = input;
  const state = await monthState(userId, lease.id, month, parsed.number);
  if (state.outcome === "no_month") {
    throw new ConflictError("The contract has no rent for that month", "receipt_month_untracked");
  }
  if (state.outcome === "duplicate") return { outcome: "duplicate", receiptIds: [] };

  const archive = (receiptId: string) =>
    documentService.create(userId, {
      name: input.fileName.slice(0, 200) || `Recibo ${monthKey(month)}`,
      description: `${ARCHIVE_MARKER_PREFIX}${receiptId}`,
      type: "receipt",
      mimeType: "application/pdf",
      fileContent: input.pdf,
      propertyId: lease.propertyId,
      tenantId: lease.tenantId,
    });

  if (state.outcome === "attach") {
    const [first] = state.unnumbered;
    // The recibo is stored before the receipt is marked emitted, so the lifecycle finds it as the
    // archive and does not write a generated PDF of its own.
    await archive(first.id);
    for (const receipt of state.unnumbered) {
      await prisma.receipt.update({
        where: { id: receipt.id },
        data: { financasNumber: parsed.number ?? "" },
      });
      if (receipt.lifecycle === "draft" || receipt.lifecycle === "review") {
        await transitionReceipt(userId, receipt.id, "emitted");
      }
    }
    await logAudit({
      userId,
      action: "UPLOAD_FINANCAS_RECEIPT",
      resourceType: "lease",
      resourceId: lease.id,
      details: {
        outcome: "attach",
        month: monthKey(month),
        number: parsed.number,
        receiptIds: state.unnumbered.map((r) => r.id),
      },
    });
    return { outcome: "attach", receiptIds: state.unnumbered.map((r) => r.id) };
  }

  const amount = parsed.rent ?? parsed.received;
  if (!amount || amount <= MONEY_EPSILON) {
    throw new ConflictError("The recibo's amount could not be read", "receipt_amount_unknown");
  }
  // A month waived when tracking began is owed again: the recibo says it was paid. Allocation
  // writes its status afresh from what it owes and what fills it.
  if (state.waived && state.periodId) {
    await prisma.rentPeriod.update({
      where: { id: state.periodId },
      data: { status: "upcoming" },
    });
  }
  const date = parsed.receivedOn ?? parsed.issuedOn ?? now.toISOString().slice(0, 10);
  const receipt = await prisma.receipt.create({
    data: {
      userId,
      tenantId: lease.tenantId,
      propertyId: lease.propertyId,
      leaseId: lease.id,
      amount,
      date: new Date(`${date}T00:00:00.000Z`),
      type: "rent",
      status: "paid",
      lifecycle: "emitted",
      source: "manual",
      referenceMonth: monthKey(month),
      financasNumber: parsed.number ?? "",
      description: parsed.number ? `Recibo de renda n.º ${parsed.number}` : "Recibo de renda",
    },
    select: { id: true },
  });
  await allocateReceipt(receipt.id);
  await archive(receipt.id);
  await logAudit({
    userId,
    action: "UPLOAD_FINANCAS_RECEIPT",
    resourceType: "receipt",
    resourceId: receipt.id,
    details: {
      outcome: "create",
      leaseId: lease.id,
      month: monthKey(month),
      number: parsed.number,
    },
  });
  return { outcome: "create", receiptIds: [receipt.id] };
}
