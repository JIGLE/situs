/**
 * Payments the owner recorded by hand that a bank movement may be the same money as.
 *
 * Nothing linked a movement to a payment it did not create, so a payment recorded by hand and then
 * seen in the bank was allocated a second time: the waterfall filled the next open month, and the
 * month that was really paid could never be called reconciled. The import and the inbox ask this
 * before they allocate anything. The match itself is pure (`findRecordedPayments`); this reads the
 * receipts it is given, always one account's.
 */

import type { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/lib/services/database/database";
import {
  RECORDED_PAYMENT_WINDOW_DAYS,
  findRecordedPayments,
  type RecordedPayment,
} from "@/lib/services/matching/engine";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What can be the other half of a movement: rent that was paid and still counts on the ledger (it
 * has live allocations, so it is not a draft nobody allocated, nor a voided one), and that no
 * movement is linked to. A payment that came from the bank has its movement, so it is never one.
 */
function recordedRent(userId: string): Prisma.ReceiptWhereInput {
  return {
    userId,
    type: "rent",
    status: "paid",
    lifecycle: { not: "voided" },
    bankTransactions: { none: {} },
    allocations: { some: { reversedAt: null } },
  };
}

/** A recorded payment as the inbox shows it: its id, the day it was recorded for, and its amount. */
export interface RecordedPaymentSummary {
  id: string;
  date: string;
  amount: number;
}

export function summarizeRecordedPayment(payment: RecordedPayment): RecordedPaymentSummary {
  return {
    id: payment.id,
    date: payment.date.toISOString().slice(0, 10),
    amount: payment.amount,
  };
}

export interface MovementFigures {
  amount: number;
  bookingDate: Date;
}

export interface MovementToCheck extends MovementFigures {
  id: string;
  suggestedLeaseId: string | null;
}

/**
 * One recorded payment, if it can still be linked to a movement: the caller's own, paid rent that
 * counts on the ledger and has no movement yet. The same test as the search, so a payment the inbox
 * offered cannot be refused for being something else.
 */
export async function findLinkablePayment(
  userId: string,
  receiptId: string,
): Promise<{ id: string; leaseId: string | null; amount: number; date: Date } | null> {
  return getPrismaClient().receipt.findFirst({
    where: { ...recordedRent(userId), id: receiptId },
    select: { id: true, leaseId: true, amount: true, date: true },
  });
}

/** The payments recorded on one lease that this movement may be, nearest first. */
export async function recordedPaymentsFor(
  userId: string,
  leaseId: string,
  movement: MovementFigures,
): Promise<RecordedPayment[]> {
  const around = RECORDED_PAYMENT_WINDOW_DAYS * DAY_MS;
  const receipts = await getPrismaClient().receipt.findMany({
    where: {
      ...recordedRent(userId),
      leaseId,
      date: {
        gte: new Date(movement.bookingDate.getTime() - around),
        lte: new Date(movement.bookingDate.getTime() + around),
      },
    },
    select: { id: true, amount: true, date: true },
  });
  return findRecordedPayments(movement, receipts);
}

/**
 * The same for a list of movements, in one query: each movement's id, and the payments recorded on
 * its suggested lease that it may be. A movement with nothing to check, or nothing found, is absent.
 */
export async function recordedPaymentsForMovements(
  userId: string,
  movements: MovementToCheck[],
): Promise<Map<string, RecordedPayment[]>> {
  const found = new Map<string, RecordedPayment[]>();
  const checkable = movements.filter(
    (movement) => movement.suggestedLeaseId && movement.amount > 0,
  );
  if (checkable.length === 0) return found;

  const around = RECORDED_PAYMENT_WINDOW_DAYS * DAY_MS;
  const booked = checkable.map((movement) => movement.bookingDate.getTime());
  const receipts = await getPrismaClient().receipt.findMany({
    where: {
      ...recordedRent(userId),
      leaseId: {
        in: [...new Set(checkable.map((movement) => movement.suggestedLeaseId as string))],
      },
      date: {
        gte: new Date(Math.min(...booked) - around),
        lte: new Date(Math.max(...booked) + around),
      },
    },
    select: { id: true, leaseId: true, amount: true, date: true },
  });

  for (const movement of checkable) {
    const onLease = receipts.filter((receipt) => receipt.leaseId === movement.suggestedLeaseId);
    const matches = findRecordedPayments(movement, onLease);
    if (matches.length > 0) found.set(movement.id, matches);
  }
  return found;
}
