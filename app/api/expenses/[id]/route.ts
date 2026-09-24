import { NextRequest } from "next/server";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { getPrismaClient } from "@/lib/services/database/database";
import { assertOwnsRelations } from "@/lib/services/database/assert-owned";
import { sanitizeForDatabase, sanitizeNumber } from "@/lib/utils/sanitize";
import { isMockMode } from "@/lib/config/data-mode";
import { z } from "zod";

// Validation schema for expense updates
const updateExpenseSchema = z.object({
  propertyId: z.string().min(1).optional(),
  amount: z.number().min(0.01, "Amount must be greater than 0").optional(),
  date: z
    .string()
    .refine((date) => !isNaN(Date.parse(date)), "Invalid date")
    .optional(),
  category: z.string().min(1).optional(),
  description: z.string().max(200, "Description too long").optional().nullable(),
  vendor: z.string().max(100, "Vendor name too long").optional().nullable(),
  documentId: z.string().optional().nullable(),
});

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

    const body = await request.json();

    // Sanitize input
    const sanitizedBody = {
      ...body,
      category: body.category ? sanitizeForDatabase(body.category) : undefined,
      description: body.description ? sanitizeForDatabase(body.description) : body.description,
      vendor: body.vendor ? sanitizeForDatabase(body.vendor) : body.vendor,
      amount: body.amount !== undefined ? sanitizeNumber(body.amount, 0, 0.01) : undefined,
    };

    const validatedData = updateExpenseSchema.parse(sanitizedBody);

    // POST checks the property an expense is booked against; moving it to another must too.
    await assertOwnsRelations(userId, { propertyId: validatedData.propertyId });

    const updateData: Record<string, unknown> = { ...validatedData };
    if (validatedData.date) {
      updateData.date = new Date(validatedData.date);
    }

    const expense = await prisma.expense.update({
      where: { id },
      data: updateData,
      include: {
        property: {
          select: { name: true },
        },
      },
    });

    return createSuccessResponse({
      ...expense,
      propertyName: expense.property.name,
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

    await prisma.expense.delete({ where: { id } });
    return createSuccessResponse({ message: "Expense deleted successfully" });
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

export const GET = withErrorHandler(handleGet);
export const PUT = withErrorHandler(handlePut);
export const DELETE = withErrorHandler(handleDelete);
export const OPTIONS = handleOptions;
