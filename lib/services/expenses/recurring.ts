import { getPrismaClient } from "@/lib/services/database/database";
import { occurrencesBetween } from "@/lib/utils/expense-recurrence";

/**
 * Make the copies of every recurring expense that have fallen due. A recurring expense used to be
 * recorded once and never again: the only code that made copies was a route nothing called, so a
 * monthly condominium fee counted once a year.
 *
 * Each template remembers the last date it made a copy for (`recurrenceGeneratedThrough`), and
 * only dates after it are made, so a copy the owner deleted stays deleted and a run that is
 * repeated makes nothing. Missed months are caught up. Idempotent, and cheap when nothing is due.
 * Scoped to one account when `userId` is given; the daily cron passes none.
 */
export async function generateDueRecurringExpenses(
  userId?: string,
  now: Date = new Date(),
): Promise<number> {
  const prisma = getPrismaClient();
  const templates = await prisma.expense.findMany({
    where: { isRecurring: true, parentExpenseId: null, ...(userId ? { userId } : {}) },
  });

  let created = 0;
  for (const template of templates) {
    const dates = occurrencesBetween(template, now, template.recurrenceGeneratedThrough);
    if (dates.length === 0) continue;
    const through = dates[dates.length - 1];

    await prisma.$transaction(async (tx) => {
      // Conditional on the cursor this run read, so two runs at once cannot both make the copies.
      const claimed = await tx.expense.updateMany({
        where: {
          id: template.id,
          recurrenceGeneratedThrough: template.recurrenceGeneratedThrough,
        },
        data: { recurrenceGeneratedThrough: through },
      });
      if (claimed.count === 0) return;
      await tx.expense.createMany({
        data: dates.map((date) => ({
          userId: template.userId,
          propertyId: template.propertyId,
          leaseId: template.leaseId,
          amount: template.amount,
          date,
          category: template.category,
          description: template.description,
          isDeductible: template.isDeductible,
          vendorName: template.vendorName,
          vendorVat: template.vendorVat,
          // A co-owner who pays the condomínio pays every month of it.
          paidByOwnerId: template.paidByOwnerId,
          isRecurring: false,
          parentExpenseId: template.id,
        })),
      });
      created += dates.length;
    });
  }
  return created;
}
