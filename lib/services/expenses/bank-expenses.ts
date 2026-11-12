import { logAudit } from "@/lib/services/audit-log";
import { isTestConnection } from "@/lib/services/bank/metadata";
import { getPrismaClient } from "@/lib/services/database/database";
import { generateDueRecurringExpenses } from "@/lib/services/expenses/recurring";
import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";
import {
  EXPENSE_MATCH_WINDOW_DAYS,
  rememberedPayee,
  suggestExpenses,
  sureExpense,
  type ExpenseLinkHistory,
  type ExpenseSuggestion,
  type MatchableExpense,
  type OutgoingMovement,
  type RememberedPayee,
} from "@/lib/utils/expense-match";
import { logger } from "@/lib/utils/logger";

/**
 * Money going out of the bank, as the expenses it paid. A movement pays at most one expense
 * (`BankTransaction.expenseId` is unique), so a cost recorded from the bank and by hand is one cost.
 * A linked movement is `matched_confirmed`: it leaves the inbox.
 */

const DAY = 86_400_000;
const LINK_HISTORY = 500;

const EXPENSE_FIELDS = {
  id: true,
  amount: true,
  date: true,
  parentExpenseId: true,
  vendorVat: true,
  vendorName: true,
  category: true,
  propertyId: true,
  isDeductible: true,
} as const;

/** The movements the owner, or the import, linked to an expense, newest first. */
async function linkHistory(userId: string): Promise<ExpenseLinkHistory[]> {
  const linked = await getPrismaClient().bankTransaction.findMany({
    where: { userId, expenseId: { not: null } },
    orderBy: { bookingDate: "desc" },
    take: LINK_HISTORY,
    select: {
      counterpartyIbanHash: true,
      counterpartyName: true,
      bookingDate: true,
      expense: { select: EXPENSE_FIELDS },
    },
  });
  return linked.flatMap((row) => (row.expense ? [{ ...row, expense: row.expense }] : []));
}

/** The expenses with no movement yet whose date is near one of these days. */
async function unlinkedExpensesAround(userId: string, days: Date[]): Promise<MatchableExpense[]> {
  if (days.length === 0) return [];
  const times = days.map((day) => day.getTime());
  const window = EXPENSE_MATCH_WINDOW_DAYS * DAY;
  return getPrismaClient().expense.findMany({
    where: {
      userId,
      bankTransaction: { is: null },
      date: {
        gte: new Date(Math.min(...times) - window),
        lte: new Date(Math.max(...times) + window),
      },
    },
    select: { id: true, amount: true, date: true, parentExpenseId: true, vendorVat: true },
  });
}

export interface MovementExpenseHints {
  suggestions: (ExpenseSuggestion & {
    date: Date;
    amount: number;
    category: string;
    propertyId: string;
    vendorName: string | null;
  })[];
  payee: RememberedPayee | null;
}

/**
 * For each movement going out that still waits: the expenses it may have paid, and what the last
 * expense paid to the same payee was, for the form to open with.
 */
export async function expenseHintsForMovements(
  userId: string,
  movements: (OutgoingMovement & { id: string; bookingDate: Date })[],
): Promise<Map<string, MovementExpenseHints>> {
  const hints = new Map<string, MovementExpenseHints>();
  const outgoing = movements.filter((movement) => movement.amount < 0);
  if (outgoing.length === 0) return hints;

  const [history, expenses] = await Promise.all([
    linkHistory(userId),
    getPrismaClient().expense.findMany({
      where: {
        userId,
        bankTransaction: { is: null },
        date: {
          gte: new Date(
            Math.min(...outgoing.map((m) => m.bookingDate.getTime())) -
              EXPENSE_MATCH_WINDOW_DAYS * DAY,
          ),
          lte: new Date(
            Math.max(...outgoing.map((m) => m.bookingDate.getTime())) +
              EXPENSE_MATCH_WINDOW_DAYS * DAY,
          ),
        },
      },
      select: EXPENSE_FIELDS,
    }),
  ]);
  const byId = new Map(expenses.map((expense) => [expense.id, expense]));

  for (const movement of outgoing) {
    const suggestions = suggestExpenses(movement, expenses, history)
      .slice(0, 3)
      .flatMap((suggestion) => {
        const expense = byId.get(suggestion.expenseId);
        return expense
          ? [
              {
                ...suggestion,
                date: expense.date,
                amount: expense.amount,
                category: expense.category,
                propertyId: expense.propertyId,
                vendorName: expense.vendorName,
              },
            ]
          : [];
      });
    hints.set(movement.id, { suggestions, payee: rememberedPayee(movement, history) });
  }
  return hints;
}

/** The movement as a link may take it: the caller's, going out, real money, and still free. */
export async function assertLinkableMovement(userId: string, movementId: string) {
  const movement = await getPrismaClient().bankTransaction.findFirst({
    where: { id: movementId, userId },
    select: {
      id: true,
      amount: true,
      expenseId: true,
      receiptId: true,
      bankAccount: { select: { connection: { select: { metadata: true } } } },
    },
  });
  if (!movement) throw new ResourceNotFoundError("Bank transaction");
  if (movement.amount >= 0) {
    throw new ConflictError("Only money going out pays an expense", "bank_movement_not_outgoing");
  }
  // Sandbox money pays nothing: an expense it wrote would stay behind when the connection goes.
  if (isTestConnection(movement.bankAccount.connection.metadata)) {
    throw new ConflictError("A test connection's movement cannot be linked", "bank_test_movement");
  }
  if (movement.expenseId || movement.receiptId) {
    throw new ConflictError("This movement is already linked", "bank_movement_linked");
  }
  return movement;
}

/**
 * Says this movement paid this expense. Conditional on both still being free, so two taps, or a
 * tap and an import, cannot link either twice.
 */
export async function linkMovementToExpense(
  userId: string,
  movementId: string,
  expenseId: string,
  how: "owner" | "import" = "owner",
): Promise<{ status: string; expenseId: string }> {
  const prisma = getPrismaClient();
  await assertLinkableMovement(userId, movementId);
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, userId },
    select: { id: true, bankTransaction: { select: { id: true } } },
  });
  if (!expense) throw new ResourceNotFoundError("Expense");
  if (expense.bankTransaction) {
    throw new ConflictError("This expense is already paid by a movement", "expense_already_linked");
  }
  try {
    const { count } = await prisma.bankTransaction.updateMany({
      where: { id: movementId, userId, expenseId: null, receiptId: null },
      data: { expenseId, status: "matched_confirmed" },
    });
    if (count === 0) {
      throw new ConflictError("This movement is already linked", "bank_movement_linked");
    }
  } catch (error) {
    // The unique index: another movement took the expense between the read and the write.
    if ((error as { code?: string }).code === "P2002") {
      throw new ConflictError(
        "This expense is already paid by a movement",
        "expense_already_linked",
      );
    }
    throw error;
  }
  await logAudit({
    userId,
    action: "LINK_EXPENSE",
    resourceType: "bank_transaction",
    resourceId: movementId,
    details: { expenseId, by: how },
  });
  return { status: "matched_confirmed", expenseId };
}

/** Takes a movement off its expense, back to the inbox. The expense stays. */
export async function unlinkMovementFromExpense(
  userId: string,
  movementId: string,
): Promise<{ status: string }> {
  const prisma = getPrismaClient();
  const movement = await prisma.bankTransaction.findFirst({
    where: { id: movementId, userId },
    select: { expenseId: true },
  });
  if (!movement) throw new ResourceNotFoundError("Bank transaction");
  if (!movement.expenseId) {
    throw new ConflictError("This movement pays no expense", "bank_movement_not_linked");
  }
  await prisma.bankTransaction.updateMany({
    where: { id: movementId, userId, expenseId: movement.expenseId },
    data: { expenseId: null, status: "needs_review" },
  });
  await logAudit({
    userId,
    action: "UNLINK_EXPENSE",
    resourceType: "bank_transaction",
    resourceId: movementId,
    details: { expenseId: movement.expenseId },
  });
  return { status: "needs_review" };
}

/**
 * After an import: a payment going out that is surely one month of a recurring expense (same
 * amount, around its date, to the payee the owner linked that series to before) is linked to
 * that month's copy. Never fails the import; a movement it cannot place waits in the inbox.
 */
export async function linkSureRecurringPayments(
  userId: string,
  syncJobId: string,
): Promise<number> {
  const prisma = getPrismaClient();
  try {
    // A copy falls due on its day; the payment may arrive before anyone opened Expenses.
    await generateDueRecurringExpenses(userId);
    const movements = await prisma.bankTransaction.findMany({
      where: {
        userId,
        syncJobId,
        amount: { lt: 0 },
        status: "needs_review",
        expenseId: null,
        receiptId: null,
      },
      select: {
        id: true,
        amount: true,
        bookingDate: true,
        counterpartyIbanHash: true,
        counterpartyName: true,
      },
    });
    if (movements.length === 0) return 0;
    const history = await linkHistory(userId);
    if (history.length === 0) return 0;
    let expenses = await unlinkedExpensesAround(
      userId,
      movements.map((movement) => movement.bookingDate),
    );

    let linked = 0;
    for (const movement of movements) {
      const expenseId = sureExpense(suggestExpenses(movement, expenses, history));
      if (!expenseId) continue;
      try {
        await linkMovementToExpense(userId, movement.id, expenseId, "import");
        expenses = expenses.filter((expense) => expense.id !== expenseId);
        linked += 1;
      } catch (error) {
        logger.warn("Could not link a payment to its recurring expense", {
          movementId: movement.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return linked;
  } catch (error) {
    logger.warn("Linking payments to recurring expenses failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * The day of the first real movement the bank brought, or null with no bank: a recurring month
 * before it was never going to be seen there.
 */
export async function bankSeenSince(userId: string): Promise<Date | null> {
  const first = await getPrismaClient().bankTransaction.findMany({
    where: { userId },
    orderBy: { bookingDate: "asc" },
    take: 50,
    select: {
      bookingDate: true,
      bankAccount: { select: { connection: { select: { metadata: true } } } },
    },
  });
  const real = first.find((row) => !isTestConnection(row.bankAccount.connection.metadata));
  return real?.bookingDate ?? null;
}
