import type { ExpenseFormData } from "@/lib/schemas/expense.schema";

/**
 * A validated expense body as Prisma data, for a create and an update alike. The form sends days
 * ("2026-11-01"); Prisma takes a DateTime, and `recurrenceEnd` used to reach it as the bare day. An expense that stops repeating loses
 * its rule, day and end, so the list stops saying when it repeats.
 */
export function expenseWriteData<T extends Partial<ExpenseFormData>>(
  body: T,
): Omit<T, "date" | "recurrenceEnd"> & {
  date?: Date;
  recurrenceEnd?: Date | null;
  recurrenceRule?: ExpenseFormData["recurrenceRule"] | null;
  recurrenceDay?: number | null;
} {
  const { date, recurrenceEnd, ...rest } = body;
  return {
    ...rest,
    ...(date !== undefined ? { date: new Date(date) } : {}),
    ...(recurrenceEnd !== undefined
      ? { recurrenceEnd: recurrenceEnd ? new Date(recurrenceEnd) : null }
      : {}),
    ...(body.isRecurring === false
      ? { recurrenceRule: null, recurrenceDay: null, recurrenceEnd: null }
      : {}),
  };
}
