import { NextRequest } from "next/server";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
  readJsonObject,
} from "@/lib/utils/error-handling";
import { getPrismaClient } from "@/lib/services/database/database";
import { assertExpenseLinks } from "@/lib/services/database/expense-links";
import { sanitizeForDatabase, sanitizeNumber } from "@/lib/utils/sanitize";
import { isMockMode } from "@/lib/config/data-mode";
import { z } from "zod";
import { expenseSchema } from "@/lib/schemas/expense.schema";
import { bankSeenSince } from "@/lib/services/expenses/bank-expenses";
import { notSeenInBank } from "@/lib/utils/expense-match";
import { expenseWriteData } from "@/lib/services/expenses/write-data";

/**
 * An update takes the same fields as a new expense, each optional. It used to take its own short
 * list, so the form could not change whether an expense repeats or counts for IRS, and it named a
 * `vendor` field that is no column (Prisma refused the write, a 500).
 */
const updateExpenseSchema = expenseSchema.partial();

// GET /api/expenses/[id] - Get a specific expense
async function handleGet(
  request: NextRequest,
  context?: {
    params?: Record<string, string> | Promise<Record<string, string>>;
  },
): Promise<Response> {
  if (isMockMode) {
    return createErrorResponse(new Error("Not available in mock mode"), 404, request);
  }

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  let id: string | undefined;
  if (context?.params) {
    const maybe = context.params as Record<string, string> | Promise<Record<string, string>>;
    const resolved = maybe instanceof Promise ? await maybe : maybe;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  try {
    const prisma = getPrismaClient();
    const expense = await prisma.expense.findFirst({
      where: { id, userId },
      include: {
        property: {
          select: { name: true },
        },
      },
    });

    if (!expense) {
      return createErrorResponse(new Error("Expense not found"), 404, request);
    }

    return createSuccessResponse({
      ...expense,
      propertyName: expense.property.name,
    });
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

// PUT /api/expenses/[id] - Update a specific expense
async function handlePut(
  request: NextRequest,
  context?: {
    params?: Record<string, string> | Promise<Record<string, string>>;
  },
): Promise<Response> {
  if (isMockMode) {
    return createErrorResponse(new Error("Not available in mock mode"), 404, request);
  }

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  let id: string | undefined;
  if (context?.params) {
    const maybe = context.params as Record<string, string> | Promise<Record<string, string>>;
    const resolved = maybe instanceof Promise ? await maybe : maybe;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  try {
    const prisma = getPrismaClient();

    // Verify the expense exists and belongs to this user
    const existing = await prisma.expense.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return createErrorResponse(new Error("Expense not found"), 404, request);
    }

    const body = await readJsonObject(request);

    // Sanitize input
    const sanitizedBody = {
      ...body,
      category: body.category ? sanitizeForDatabase(body.category) : undefined,
      description: body.description ? sanitizeForDatabase(body.description) : body.description,
      vendorName: body.vendorName ? sanitizeForDatabase(body.vendorName) : body.vendorName,
      amount: body.amount !== undefined ? sanitizeNumber(body.amount, 0, 0.01) : undefined,
    };

    // Only the fields the request sent: the schema's defaults (repeats: no, deductible: yes) are
    // for a new expense, and applied here they would overwrite the stored ones.
    const parsed = updateExpenseSchema.parse(sanitizedBody);
    const validatedData = Object.fromEntries(
      Object.entries(parsed).filter(
        ([field]) => (sanitizedBody as Record<string, unknown>)[field] !== undefined,
      ),
    ) as typeof parsed;

    // POST checks what an expense points at; an update must too, as the expense will stand after it.
    await assertExpenseLinks(userId, {
      propertyId: validatedData.propertyId ?? existing.propertyId,
      leaseId: existing.leaseId,
      documentId:
        validatedData.documentId !== undefined ? validatedData.documentId : existing.documentId,
    });

    const updateData = expenseWriteData(validatedData);

    const { bankTransaction, ...expense } = await prisma.expense.update({
      where: { id },
      data: updateData,
      include: {
        property: {
          select: { name: true },
        },
        bankTransaction: { select: { id: true } },
      },
    });

    // As the list gives it, so the row the app replaces keeps its bank state.
    return createSuccessResponse({
      ...expense,
      propertyName: expense.property.name,
      bankTransactionId: bankTransaction?.id ?? null,
      notSeenInBank: notSeenInBank(
        { ...expense, linked: !!bankTransaction },
        await bankSeenSince(userId),
        new Date(),
      ),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse(
        new Error(`Validation error: ${error.issues.map((e) => e.message).join(", ")}`),
        400,
        request,
      );
    }
    return createErrorResponse(error as Error, 500, request);
  }
}

// DELETE /api/expenses/[id] - Delete a specific expense
async function handleDelete(
  request: NextRequest,
  context?: {
    params?: Record<string, string> | Promise<Record<string, string>>;
  },
): Promise<Response> {
  if (isMockMode) {
    return createErrorResponse(new Error("Not available in mock mode"), 404, request);
  }

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  let id: string | undefined;
  if (context?.params) {
    const maybe = context.params as Record<string, string> | Promise<Record<string, string>>;
    const resolved = maybe instanceof Promise ? await maybe : maybe;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  try {
    const prisma = getPrismaClient();

    // Verify the expense exists and belongs to this user
    const existing = await prisma.expense.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return createErrorResponse(new Error("Expense not found"), 404, request);
    }

    // The movement that paid it goes back to the inbox, rather than reading as dealt with.
    await prisma.$transaction([
      prisma.bankTransaction.updateMany({
        where: { userId, expenseId: id },
        data: { expenseId: null, status: "needs_review" },
      }),
      prisma.expense.delete({ where: { id } }),
    ]);
    return createSuccessResponse({ message: "Expense deleted successfully" });
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

export const GET = withErrorHandler(handleGet);
export const PUT = withErrorHandler(handlePut);
export const DELETE = withErrorHandler(handleDelete);
export const OPTIONS = handleOptions;
