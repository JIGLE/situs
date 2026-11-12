import { NextRequest } from "next/server";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { expenseSchema } from "@/lib/schemas/expense.schema";
import { isMockMode } from "@/lib/config/data-mode";
import { createSuccessResponse, parseJsonBody, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { assertExpenseLinks } from "@/lib/services/database/expense-links";
import { generateDueRecurringExpenses } from "@/lib/services/expenses/recurring";
import { expenseWriteData } from "@/lib/services/expenses/write-data";
import {
  assertLinkableMovement,
  bankSeenSince,
  linkMovementToExpense,
} from "@/lib/services/expenses/bank-expenses";
import { notSeenInBank } from "@/lib/utils/expense-match";
import { z } from "zod";

/** A new expense, and the bank movement that paid it when it is recorded from one. */
const createExpenseBody = expenseSchema.extend({ bankTransactionId: z.string().optional() });

async function handleGet(request: NextRequest): Promise<Response> {
  if (isMockMode) {
    return createSuccessResponse([]);
  }
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  // The copies of a recurring expense that fell due since the last read, so the list is whole
  // even where no daily cron runs.
  await generateDueRecurringExpenses(userId);

  const [expenses, since] = await Promise.all([
    prisma.expense.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      include: {
        property: {
          select: {
            name: true,
          },
        },
        bankTransaction: { select: { id: true } },
      },
    }),
    bankSeenSince(userId),
  ]);

  const now = new Date();
  const transformedExpenses = expenses.map(({ bankTransaction, ...expense }) => ({
    ...expense,
    propertyName: expense.property.name,
    bankTransactionId: bankTransaction?.id ?? null,
    notSeenInBank: notSeenInBank({ ...expense, linked: !!bankTransaction }, since, now),
  }));

  return createSuccessResponse(transformedExpenses);
}

async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  const { bankTransactionId, ...body } = await parseJsonBody(request, createExpenseBody);
  // Refused before anything is written: a movement that cannot pay it leaves no expense behind.
  if (bankTransactionId) await assertLinkableMovement(userId, bankTransactionId);

  // `propertyId` comes from the request body, and the schema only checks it is a non-empty
  // string. Without this, an expense could be filed against another landlord's property.
  await assertExpenseLinks(userId, {
    propertyId: body.propertyId,
    leaseId: body.leaseId,
    documentId: body.documentId,
  });

  const expense = await prisma.expense.create({
    data: {
      ...expenseWriteData(body),
      date: new Date(body.date),
      userId,
    },
    include: {
      property: {
        select: {
          name: true,
        },
      },
    },
  });

  if (bankTransactionId) {
    try {
      await linkMovementToExpense(userId, bankTransactionId, expense.id);
    } catch (error) {
      // Taken between the check and now: the expense goes with it, so the owner can try again.
      await prisma.expense.delete({ where: { id: expense.id } });
      throw error;
    }
  }

  return createSuccessResponse(
    {
      ...expense,
      propertyName: expense.property.name,
      bankTransactionId: bankTransactionId ?? null,
      notSeenInBank: false,
    },
    201,
  );
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
