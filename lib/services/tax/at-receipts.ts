/**
 * Receipts and Finanças, one rent month at a time: what AT would receive for each month the chosen
 * receipts pay, what stops it, and, in the test mode, sending it to AT's test service.
 *
 * A test records nothing in Situs. AT's test service issues receipts that do not count, so a
 * receipt sent there stays here as it was, draft or review, and only the submission log and the
 * audit trail say it went. Recording a receipt AT issued (its number, its PDF as the archive)
 * belongs to going live, which this does not do: the only endpoint it can reach is the test one.
 *
 * Every read is scoped to the owner. People are read through their own models, never nested, so
 * the PII extension decrypts their NIFs: owners through `owner`, tenants through `tenant`, and a
 * lease's co-tenants through `partiesByLease`. Guarantors are left out: a receipt names who pays.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { partiesByLease } from "@/lib/services/database/lease-parties";
import { logAudit } from "@/lib/services/audit-log";
import { emitirRecibo } from "@/lib/tax/at/client";
import {
  buildReceiptRequest,
  MAX_TEST_MONTHS,
  receiptBlockers,
  type AtLandlord,
  type AtReceiptBlocker,
  type AtReceiptInput,
  type AtTenant,
} from "@/lib/tax/at/receipt-request";
import { TEST_MODES } from "@/lib/tax/connectors/modes";
import { sumMoney } from "@/lib/utils/money";
import { isIssuable } from "@/lib/utils/receipt-months";
import { getAtConnection, logCall, prepareCall, toView, type AtCallView } from "./at-connection";

/** Why a whole receipt cannot go to AT, before any month is looked at. */
export type AtReceiptRefusal = "not_issuable" | "not_rent" | "not_paid" | "no_rent_month";

export interface AtReceiptMonth {
  periodId: string;
  year: number;
  month: number;
  /** What the receipt put towards the month. */
  amount: number;
  receivedOn: string;
  contractNumber: string | null;
  contractVersion: number | null;
  landlords: AtLandlord[];
  tenants: AtTenant[];
  blockers: AtReceiptBlocker[];
}

export interface AtReceiptPreviewEntry {
  receiptId: string;
  refusal: AtReceiptRefusal | null;
  months: AtReceiptMonth[];
}

export interface AtReceiptPreview {
  mode: string;
  /** The test mode, with a login stored and the certificate files ready: a test can go. */
  canTest: boolean;
  receipts: AtReceiptPreviewEntry[];
}

export type AtReceiptTestMonth = Pick<AtReceiptMonth, "periodId" | "year" | "month"> &
  (
    | { status: "blocked"; blockers: AtReceiptBlocker[] }
    /** AT answered, or the call failed; `receiptNumber` is the test service's, on a 0. */
    | { status: "sent"; call: AtCallView; receiptNumber: number | null }
    /** Not sent: an earlier call failed in a way every later one would, or the cap was reached. */
    | { status: "skipped" }
  );

export interface AtReceiptTestEntry {
  receiptId: string;
  refusal: AtReceiptRefusal | null;
  months: AtReceiptTestMonth[];
}

const unique = <T>(values: T[]) => [...new Set(values)];

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

async function gather(
  userId: string,
  receiptIds: string[],
  now: Date,
): Promise<AtReceiptPreviewEntry[]> {
  const prisma = getPrismaClient();
  const receipts = await prisma.receipt.findMany({
    where: { userId, id: { in: unique(receiptIds) } },
    select: { id: true, date: true, type: true, status: true, lifecycle: true },
  });
  if (receipts.length === 0) return [];

  const allocations = await prisma.paymentAllocation.findMany({
    where: { userId, receiptId: { in: receipts.map((receipt) => receipt.id) }, reversedAt: null },
    select: {
      receiptId: true,
      amount: true,
      rentPeriod: { select: { id: true, year: true, month: true, leaseId: true } },
    },
  });

  const leaseIds = unique(allocations.map((allocation) => allocation.rentPeriod.leaseId));
  const leases = await prisma.lease.findMany({
    where: { userId, id: { in: leaseIds } },
    select: {
      id: true,
      tenantId: true,
      propertyId: true,
      atContractNumber: true,
      atContractVersion: true,
    },
  });
  const propertyIds = unique(leases.map((lease) => lease.propertyId));
  const shares = await prisma.propertyOwner.findMany({
    where: { propertyId: { in: propertyIds }, property: { userId } },
    select: { propertyId: true, ownerId: true },
    orderBy: { createdAt: "asc" },
  });
  const [owners, tenants, parties] = await Promise.all([
    prisma.owner.findMany({
      where: { userId, id: { in: unique(shares.map((share) => share.ownerId)) } },
      select: { id: true, name: true, taxIdentificationNumber: true },
    }),
    prisma.tenant.findMany({
      where: { userId, id: { in: unique(leases.map((lease) => lease.tenantId)) } },
      select: { id: true, name: true, taxId: true, taxCountry: true, idDocument: true },
    }),
    partiesByLease(userId, leaseIds),
  ]);

  const leaseById = new Map(leases.map((lease) => [lease.id, lease]));
  const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));

  const landlordsOf = (propertyId: string): AtLandlord[] =>
    shares
      .filter((share) => share.propertyId === propertyId)
      .flatMap((share) => {
        const owner = ownerById.get(share.ownerId);
        return owner ? [{ name: owner.name, nif: owner.taxIdentificationNumber }] : [];
      });

  const tenantsOf = (lease: { id: string; tenantId: string }): AtTenant[] => {
    const main = tenantById.get(lease.tenantId);
    const coTenants = (parties.get(lease.id) ?? []).filter((party) => party.role === "tenant");
    return [
      ...(main
        ? [
            {
              name: main.name,
              nif: main.taxId,
              country: main.taxCountry,
              document: main.idDocument,
            },
          ]
        : []),
      ...coTenants.map((party) => ({
        name: party.name,
        nif: party.taxId ?? null,
        country: party.taxCountry ?? null,
        document: party.idDocument ?? null,
      })),
    ];
  };

  const today = isoDate(now);
  return receipts.map((receipt) => {
    const receivedOn = isoDate(receipt.date);
    const byPeriod = new Map<
      string,
      { period: (typeof allocations)[number]["rentPeriod"]; amounts: number[] }
    >();
    for (const allocation of allocations) {
      if (allocation.receiptId !== receipt.id) continue;
      const entry = byPeriod.get(allocation.rentPeriod.id) ?? {
        period: allocation.rentPeriod,
        amounts: [],
      };
      entry.amounts.push(allocation.amount);
      byPeriod.set(allocation.rentPeriod.id, entry);
    }

    const months = [...byPeriod.values()]
      .sort((a, b) => a.period.year - b.period.year || a.period.month - b.period.month)
      .map(({ period, amounts }): AtReceiptMonth => {
        const lease = leaseById.get(period.leaseId);
        const input: AtReceiptInput = {
          contractNumber: lease?.atContractNumber ?? null,
          contractVersion: lease?.atContractVersion ?? null,
          landlords: lease ? landlordsOf(lease.propertyId) : [],
          tenants: lease ? tenantsOf(lease) : [],
          year: period.year,
          month: period.month,
          amount: sumMoney(amounts),
          receivedOn,
          today,
        };
        return {
          periodId: period.id,
          year: input.year,
          month: input.month,
          amount: input.amount,
          receivedOn,
          contractNumber: input.contractNumber,
          contractVersion: input.contractVersion,
          landlords: input.landlords,
          tenants: input.tenants,
          blockers: receiptBlockers(input),
        };
      });

    const refusal: AtReceiptRefusal | null = !isIssuable(receipt.lifecycle)
      ? "not_issuable"
      : receipt.type !== "rent"
        ? "not_rent"
        : receipt.status !== "paid"
          ? "not_paid"
          : months.length === 0
            ? "no_rent_month"
            : null;
    return { receiptId: receipt.id, refusal, months };
  });
}

/** What AT would receive for each month the receipts pay, and what stops each. Reads only. */
export async function previewAtReceipts(
  userId: string,
  receiptIds: string[],
  now: Date = new Date(),
): Promise<AtReceiptPreview> {
  const [connection, receipts] = await Promise.all([
    getAtConnection(userId),
    gather(userId, receiptIds, now),
  ]);
  return {
    mode: connection.mode,
    canTest: TEST_MODES.has(connection.mode) && connection.passwordSet && connection.files.ready,
    receipts,
  };
}

/**
 * An answer that says nothing about this receipt, only about the login, the files, the request
 * or AT itself: every later call would get it too, and repeating a refused login can suspend the
 * Portal user. Only 0 (issued) and −1 (this receipt refused) let the next month go.
 */
function stopsTheRest(call: AtCallView): boolean {
  return !(call.outcome === "answer" && (call.category === "ok" || call.category === "rejected"));
}

/**
 * Sends each month that nothing blocks to AT's test service, one at a time, and says what AT
 * answered. Needs the test mode, a login and the files (a 409 names what is missing). Records
 * nothing on the receipts: the log gets a row per month sent and the audit trail an entry per
 * receipt.
 */
export async function testAtReceipts(
  userId: string,
  receiptIds: string[],
  now: Date = new Date(),
): Promise<AtReceiptTestEntry[]> {
  const { connector, context } = await prepareCall(userId);
  // `<NIF>/<n>`: the NIF is the receipt's issuer.
  const issuerNif = context.login.username.split("/")[0];
  const entries = await gather(userId, receiptIds, now);

  let sent = 0;
  let stopped = false;
  const results: AtReceiptTestEntry[] = [];
  for (const entry of entries) {
    const months: AtReceiptTestMonth[] = [];
    // A refused receipt sends no month at all; the refusal says why.
    for (const month of entry.refusal ? [] : entry.months) {
      const base = { periodId: month.periodId, year: month.year, month: month.month };
      const request = buildReceiptRequest(
        {
          contractNumber: month.contractNumber,
          contractVersion: month.contractVersion,
          landlords: month.landlords,
          tenants: month.tenants,
          year: month.year,
          month: month.month,
          amount: month.amount,
          receivedOn: month.receivedOn,
          today: isoDate(now),
        },
        issuerNif,
      );
      if (!request.ok) {
        months.push({ ...base, status: "blocked", blockers: request.blockers });
        continue;
      }
      if (stopped || sent >= MAX_TEST_MONTHS) {
        months.push({ ...base, status: "skipped" });
        continue;
      }

      const result = await emitirRecibo(context, request.fields);
      sent += 1;
      const issued = result.outcome === "answer" && result.code === 0;
      await logCall(
        userId,
        connector,
        {
          subjectType: "receipt",
          subjectId: `${entry.receiptId}/${month.year}-${String(month.month).padStart(2, "0")}`,
          action: "submit",
        },
        result,
        issued,
      );
      const call = toView(result);
      months.push({
        ...base,
        status: "sent",
        call,
        receiptNumber: issued ? (result.receiptNumber ?? null) : null,
      });
      if (stopsTheRest(call)) stopped = true;
    }

    const answered = months.filter(
      (month): month is Extract<AtReceiptTestMonth, { status: "sent" }> => month.status === "sent",
    );
    if (answered.length > 0) {
      await logAudit({
        userId,
        action: "TEST_AT_RECEIPT",
        resourceType: "receipt",
        resourceId: entry.receiptId,
        details: {
          months: answered.map((month) => ({
            month: `${month.year}-${String(month.month).padStart(2, "0")}`,
            outcome: month.call.outcome,
            ...(month.call.outcome === "answer" ? { code: month.call.code } : {}),
          })),
        },
      });
    }
    results.push({ receiptId: entry.receiptId, refusal: entry.refusal, months });
  }
  return results;
}
