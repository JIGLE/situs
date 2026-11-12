/**
 * Reads a year of money for the owner-payout split (`split.ts`) and records payouts.
 *
 * Income is the money received in the year (`countsAsIncome`: paid, not voided, not a deposit),
 * on the property its receipt names. It belongs to the reference month the receipt pays when it
 * has one, so a share that changed mid-year splits each month's rent by that month's owners, as
 * an AT receipt names them; otherwise it belongs to the day it was received. Expenses are the
 * property's expenses dated in the year, as the expenses screen stores them.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { ResourceNotFoundError } from "@/lib/utils/error-handling";
import { countsAsIncome } from "@/lib/utils/receipt-income";
import { round2 } from "@/lib/utils/money";
import { splitYear, type PropertyMoney, type YearSplit } from "./split";

const yearRange = (year: number) => ({
  gte: new Date(Date.UTC(year, 0, 1)),
  lt: new Date(Date.UTC(year + 1, 0, 1)),
});

/** The first day of a "YYYY-MM" reference month, or null for anything else. */
function referenceDay(referenceMonth: string | null): Date | null {
  const match = referenceMonth ? /^(\d{4})-(\d{2})$/.exec(referenceMonth) : null;
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(Number(match[1]), month - 1, 1));
}

export async function getOwnerPayoutYear(userId: string, year: number): Promise<YearSplit> {
  const prisma = getPrismaClient();
  const range = yearRange(year);

  const [shares, receipts, expenses, payouts] = await Promise.all([
    prisma.propertyOwner.findMany({
      where: { property: { userId }, owner: { userId } },
      select: {
        propertyId: true,
        ownerId: true,
        ownershipPercentage: true,
        validFrom: true,
        validTo: true,
        owner: { select: { name: true } },
        property: { select: { name: true } },
      },
    }),
    prisma.receipt.findMany({
      where: { userId, date: range, status: "paid" },
      select: {
        propertyId: true,
        amount: true,
        date: true,
        type: true,
        status: true,
        lifecycle: true,
        referenceMonth: true,
      },
    }),
    prisma.expense.findMany({
      where: { userId, date: range },
      select: { propertyId: true, amount: true, date: true },
    }),
    prisma.ownerPayout.findMany({
      where: { userId, year, owner: { userId } },
      select: { id: true, ownerId: true, amount: true, paidAt: true, note: true },
    }),
  ]);

  const properties = new Map<string, PropertyMoney>();
  for (const share of shares) {
    let property = properties.get(share.propertyId);
    if (!property) {
      property = {
        propertyId: share.propertyId,
        propertyName: share.property.name,
        shares: [],
        income: [],
        expenses: [],
      };
      properties.set(share.propertyId, property);
    }
    property.shares.push({
      ownerId: share.ownerId,
      ownerName: share.owner.name,
      percentage: share.ownershipPercentage,
      validFrom: share.validFrom,
      validTo: share.validTo,
    });
  }
  for (const receipt of receipts) {
    if (!countsAsIncome(receipt)) continue;
    properties.get(receipt.propertyId)?.income.push({
      amount: receipt.amount,
      day: referenceDay(receipt.referenceMonth) ?? receipt.date,
    });
  }
  for (const expense of expenses) {
    properties
      .get(expense.propertyId)
      ?.expenses.push({ amount: expense.amount, day: expense.date });
  }

  return splitYear(year, [...properties.values()], payouts);
}

export interface PayoutInput {
  ownerId: string;
  year: number;
  amount: number;
  paidAt: Date;
  note?: string | null;
}

export async function recordOwnerPayout(userId: string, input: PayoutInput) {
  const prisma = getPrismaClient();
  const owner = await prisma.owner.findFirst({
    where: { id: input.ownerId, userId },
    select: { id: true, name: true },
  });
  if (!owner) throw new ResourceNotFoundError("Owner not found");
  const payout = await prisma.ownerPayout.create({
    data: {
      userId,
      ownerId: owner.id,
      year: input.year,
      amount: round2(input.amount),
      paidAt: input.paidAt,
      note: input.note?.trim() || null,
    },
  });
  return { payout, ownerName: owner.name };
}

/** Removes a payout recorded by mistake. Scoped: another account's id is not found. */
export async function deleteOwnerPayout(userId: string, id: string) {
  const prisma = getPrismaClient();
  const payout = await prisma.ownerPayout.findFirst({ where: { id, userId } });
  if (!payout) throw new ResourceNotFoundError("Payout not found");
  await prisma.ownerPayout.delete({ where: { id: payout.id } });
  return payout;
}
