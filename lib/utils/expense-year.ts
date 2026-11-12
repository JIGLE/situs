import { round2 } from "@/lib/utils/money";

/** What the year view needs of an expense. */
export interface YearExpense {
  propertyId: string;
  propertyName?: string;
  amount: number;
  date: string;
  isDeductible?: boolean;
}

/** The years to choose from: every year with an expense, and this one, newest first. */
export function expenseYears(expenses: readonly { date: string }[], now: Date = new Date()) {
  const years = new Set<number>([now.getFullYear()]);
  for (const expense of expenses) years.add(Number(expense.date.slice(0, 4)));
  return [...years].filter(Number.isFinite).sort((a, b) => b - a);
}

/** Whether an expense counts against rent for IRS. Unset is the schema's default: yes. */
export const isDeductible = (expense: { isDeductible?: boolean }) => expense.isDeductible !== false;

/**
 * A year of expenses as the Expenses tab shows it: the totals, the months newest first with each
 * month's total, and each property's total and deductible part (what Anexo F asks for, property by
 * property). Months and years are read from the stored day, not a time zone's idea of it.
 */
export function summariseYear<T extends YearExpense>(expenses: readonly T[], year: number) {
  const inYear = expenses
    .filter((expense) => Number(expense.date.slice(0, 4)) === year)
    .sort((a, b) => b.date.localeCompare(a.date));

  const months = new Map<number, { month: number; total: number; items: T[] }>();
  const properties = new Map<
    string,
    { propertyId: string; propertyName?: string; total: number; deductible: number }
  >();
  for (const expense of inYear) {
    const month = Number(expense.date.slice(5, 7));
    const bucket = months.get(month) ?? { month, total: 0, items: [] };
    bucket.total += expense.amount;
    bucket.items.push(expense);
    months.set(month, bucket);

    const property = properties.get(expense.propertyId) ?? {
      propertyId: expense.propertyId,
      propertyName: expense.propertyName,
      total: 0,
      deductible: 0,
    };
    property.total += expense.amount;
    if (isDeductible(expense)) property.deductible += expense.amount;
    properties.set(expense.propertyId, property);
  }

  return {
    count: inYear.length,
    total: round2(inYear.reduce((sum, e) => sum + e.amount, 0)),
    deductible: round2(inYear.filter(isDeductible).reduce((sum, e) => sum + e.amount, 0)),
    months: [...months.values()].map((m) => ({ ...m, total: round2(m.total) })),
    byProperty: [...properties.values()]
      .map((p) => ({ ...p, total: round2(p.total), deductible: round2(p.deductible) }))
      .sort((a, b) => b.total - a.total),
  };
}
