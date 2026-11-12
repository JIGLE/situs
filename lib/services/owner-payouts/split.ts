/**
 * A year's net rental income, split between the owners of each property. Pure: no Prisma.
 *
 * The account collects the whole rent of a property it shares and pays the other owners their
 * part later, usually once a year. Each owner's part is worked out here, never stored: rent
 * received in the year less the property's expenses of the year, split by the shares in force
 * on the day each amount belongs to (`ownership.ts`). A share that changed in June splits the
 * money of January by January's shares and the money of July by July's. What has been paid out
 * is stored (`OwnerPayout`), so the balance is the share less those payouts, and a late payment
 * or a forgotten expense moves it.
 *
 * Amounts are split unrounded and then rounded once per property with the largest remainder, so
 * the owners' parts of a property add up to its figure to the cent.
 */

import { isInForceOn, type ShareSpan } from "@/lib/services/database/ownership";
import { round2, sumMoney } from "@/lib/utils/money";

/** Where a property's money goes on a day no share covers: no owner was recorded for it. */
export const UNASSIGNED = "__unassigned__";

export interface ShareRow extends ShareSpan {
  ownerId: string;
  ownerName: string;
  /** 0–100 */
  percentage: number;
}

/** One amount of money and the day it belongs to, which decides whose share it is. */
export interface MoneyItem {
  amount: number;
  day: Date;
  /**
   * An expense one owner paid from their own pocket rather than from the rent: it still comes
   * off the property's net for everyone by share, and that owner is paid it back in full.
   */
  paidByOwnerId?: string | null;
}

export interface PropertyMoney {
  propertyId: string;
  propertyName: string;
  shares: ShareRow[];
  /** Rent and other income received in the year. Deposits are not income and are left out. */
  income: MoneyItem[];
  expenses: MoneyItem[];
}

export interface PayoutRecord {
  id: string;
  ownerId: string;
  amount: number;
  paidAt: Date;
  note: string | null;
}

export interface OwnerPart {
  ownerId: string;
  ownerName: string;
  /** Each distinct share the owner held during the year, in order: [50] or [50, 40]. */
  percentages: number[];
  income: number;
  expenses: number;
  /** Expenses this owner paid themselves, paid back to them on top of their share. */
  reimbursed: number;
  /** income − expenses + reimbursed: what the owner is due from this property. */
  net: number;
}

export interface PropertySplit {
  propertyId: string;
  propertyName: string;
  income: number;
  expenses: number;
  net: number;
  owners: OwnerPart[];
  /** Money from days on which the recorded shares add up to less than 100%. */
  unassigned: { income: number; expenses: number; net: number } | null;
  /** Whether the shares changed during the year, so the split is not one set of percentages. */
  sharesChanged: boolean;
}

export interface OwnerStatement {
  ownerId: string;
  ownerName: string;
  /** The properties the owner had a share in during the year. */
  propertyIds: string[];
  income: number;
  expenses: number;
  reimbursed: number;
  /** The owner's part of the year's net income, with what they paid themselves added back. */
  net: number;
  paid: number;
  /** What is still to be paid to the owner; below zero, what the owner owes back. */
  balance: number;
  payouts: PayoutRecord[];
  /**
   * The owner who collects the rent: their balance is what they keep, not a debt to them, so it
   * stays out of `outstanding`.
   */
  collects: boolean;
}

export interface YearSplit {
  year: number;
  /** Properties with an owner in the year that one owner held alone, whether listed or not. */
  soleOwnerProperties: number;
  income: number;
  expenses: number;
  net: number;
  paid: number;
  /** The positive balances of owners who do not collect the rent: what is still to be paid out. */
  outstanding: number;
  properties: PropertySplit[];
  owners: OwnerStatement[];
}

const yearStart = (year: number) => new Date(Date.UTC(year, 0, 1));
const yearEnd = (year: number) => new Date(Date.UTC(year + 1, 0, 1));

/** Whether a share held on any day of the year. */
function overlapsYear(share: ShareSpan, year: number): boolean {
  return (
    (share.validFrom === null || share.validFrom < yearEnd(year)) &&
    (share.validTo === null || share.validTo > yearStart(year))
  );
}

/**
 * Split cents between keys in proportion to their unrounded parts, so the rounded parts add up
 * to the rounded total exactly: each key takes its part rounded down, and the cents left over go
 * to the keys with the largest remainders.
 */
export function splitCents(parts: Map<string, number>, total: number): Map<string, number> {
  const totalCents = Math.round(total * 100);
  const entries = [...parts.entries()].map(([key, value]) => {
    const exact = value * 100;
    const floor = Math.floor(exact + 1e-9);
    return { key, floor, remainder: exact - floor };
  });
  let left = totalCents - entries.reduce((sum, e) => sum + e.floor, 0);
  const byRemainder = [...entries].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; left > 0 && byRemainder.length > 0; i = (i + 1) % byRemainder.length, left--) {
    byRemainder[i].floor += 1;
  }
  return new Map(entries.map((e) => [e.key, e.floor / 100]));
}

/** Each owner's unrounded part of these amounts, by the shares in force on each amount's day. */
function splitItems(items: MoneyItem[], shares: ShareRow[]): Map<string, number> {
  const parts = new Map<string, number>();
  const add = (key: string, value: number) => parts.set(key, (parts.get(key) ?? 0) + value);
  for (const item of items) {
    const held = shares.filter((share) => isInForceOn(share, item.day));
    let covered = 0;
    for (const share of held) {
      add(share.ownerId, (item.amount * share.percentage) / 100);
      covered += share.percentage;
    }
    if (covered < 100 - 0.001) add(UNASSIGNED, (item.amount * (100 - covered)) / 100);
  }
  return parts;
}

export function splitProperty(property: PropertyMoney, year: number): PropertySplit {
  const shares = property.shares
    .filter((share) => overlapsYear(share, year))
    .sort((a, b) => (a.validFrom?.getTime() ?? 0) - (b.validFrom?.getTime() ?? 0));
  const income = sumMoney(property.income.map((item) => item.amount));
  const expenses = sumMoney(property.expenses.map((item) => item.amount));
  const incomeParts = splitCents(splitItems(property.income, shares), income);
  const expenseParts = splitCents(splitItems(property.expenses, shares), expenses);

  const owners = new Map<string, OwnerPart>();
  const partOf = (ownerId: string, ownerName: string) => {
    const part = owners.get(ownerId) ?? {
      ownerId,
      ownerName,
      percentages: [],
      income: 0,
      expenses: 0,
      reimbursed: 0,
      net: 0,
    };
    owners.set(ownerId, part);
    return part;
  };
  for (const share of shares) {
    const part = partOf(share.ownerId, share.ownerName);
    const last = part.percentages.at(-1);
    if (last === undefined || Math.abs(last - share.percentage) > 0.001) {
      part.percentages.push(share.percentage);
    }
  }
  const names = new Map(property.shares.map((share) => [share.ownerId, share.ownerName]));
  for (const item of property.expenses) {
    if (!item.paidByOwnerId) continue;
    const part = partOf(item.paidByOwnerId, names.get(item.paidByOwnerId) ?? "—");
    part.reimbursed += item.amount;
  }
  for (const part of owners.values()) {
    part.income = incomeParts.get(part.ownerId) ?? 0;
    part.expenses = expenseParts.get(part.ownerId) ?? 0;
    part.reimbursed = round2(part.reimbursed);
    part.net = round2(part.income - part.expenses + part.reimbursed);
  }

  const unassignedIncome = incomeParts.get(UNASSIGNED) ?? 0;
  const unassignedExpenses = expenseParts.get(UNASSIGNED) ?? 0;
  // Changed when a share started or ended inside the year, not on its first day.
  const sharesChanged = shares.some(
    (share) =>
      (share.validFrom !== null && share.validFrom > yearStart(year)) ||
      (share.validTo !== null && share.validTo < yearEnd(year)),
  );

  return {
    propertyId: property.propertyId,
    propertyName: property.propertyName,
    income,
    expenses,
    net: round2(income - expenses),
    owners: [...owners.values()].sort(
      (a, b) => b.net - a.net || a.ownerName.localeCompare(b.ownerName),
    ),
    unassigned:
      unassignedIncome !== 0 || unassignedExpenses !== 0
        ? {
            income: unassignedIncome,
            expenses: unassignedExpenses,
            net: round2(unassignedIncome - unassignedExpenses),
          }
        : null,
    sharesChanged,
  };
}

/**
 * The year for every property with an owner recorded during it, and for every owner across
 * their properties, with what has been paid out to each.
 */
export function splitYear(
  year: number,
  properties: PropertyMoney[],
  payouts: PayoutRecord[],
  options: { sharedOnly?: boolean; collectors?: ReadonlySet<string> } = {},
): YearSplit {
  const collectors = options.collectors ?? new Set<string>();
  const all = properties
    .filter((property) => property.shares.some((share) => overlapsYear(share, year)))
    .map((property) => splitProperty(property, year));
  // A property one owner holds alone has nobody to pay; left out, the account's own properties
  // do not bury the shared ones, nor swell "still to pay" with money the owner keeps.
  const shared = all.filter((split) => split.owners.length > 1);
  const splits = (options.sharedOnly ? shared : all)
    // Shared properties first: they are the ones with someone to pay.
    .sort(
      (a, b) =>
        Number(b.owners.length > 1) - Number(a.owners.length > 1) ||
        a.propertyName.localeCompare(b.propertyName),
    );

  const owners = new Map<string, OwnerStatement>();
  const statementOf = (ownerId: string, ownerName: string) => {
    let statement = owners.get(ownerId);
    if (!statement) {
      statement = {
        ownerId,
        ownerName,
        propertyIds: [],
        income: 0,
        expenses: 0,
        reimbursed: 0,
        net: 0,
        paid: 0,
        balance: 0,
        payouts: [],
        collects: collectors.has(ownerId),
      };
      owners.set(ownerId, statement);
    }
    return statement;
  };

  const parts = new Map<string, OwnerPart[]>();
  for (const split of splits) {
    for (const part of split.owners) {
      const statement = statementOf(part.ownerId, part.ownerName);
      statement.propertyIds.push(split.propertyId);
      parts.set(part.ownerId, [...(parts.get(part.ownerId) ?? []), part]);
    }
  }

  const ownerNames = new Map(
    properties.flatMap((property) =>
      property.shares.map((share) => [share.ownerId, share.ownerName] as const),
    ),
  );
  for (const payout of payouts) {
    // A payout to an owner with no share this year still shows, so it is never lost from view.
    const statement = statementOf(payout.ownerId, ownerNames.get(payout.ownerId) ?? "—");
    statement.payouts.push(payout);
  }

  for (const statement of owners.values()) {
    const mine = parts.get(statement.ownerId) ?? [];
    statement.income = sumMoney(mine.map((part) => part.income));
    statement.expenses = sumMoney(mine.map((part) => part.expenses));
    statement.reimbursed = sumMoney(mine.map((part) => part.reimbursed));
    statement.net = round2(statement.income - statement.expenses + statement.reimbursed);
    statement.payouts.sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
    statement.paid = sumMoney(statement.payouts.map((payout) => payout.amount));
    statement.balance = round2(statement.net - statement.paid);
  }

  // The collector last: everyone above is someone to pay.
  const ownerList = [...owners.values()].sort(
    (a, b) =>
      Number(a.collects) - Number(b.collects) ||
      b.balance - a.balance ||
      a.ownerName.localeCompare(b.ownerName),
  );

  return {
    year,
    soleOwnerProperties: all.length - shared.length,
    income: sumMoney(splits.map((split) => split.income)),
    expenses: sumMoney(splits.map((split) => split.expenses)),
    net: sumMoney(splits.map((split) => split.net)),
    paid: sumMoney(ownerList.map((owner) => owner.paid)),
    outstanding: sumMoney(
      ownerList.filter((owner) => !owner.collects).map((owner) => Math.max(owner.balance, 0)),
    ),
    properties: splits,
    owners: ownerList,
  };
}
