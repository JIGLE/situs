import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseJsonBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { buildingExpenseSchema } from "@/lib/schemas/building-expense.schema";
import { deleteBuildingExpense, updateBuildingExpense } from "@/lib/services/buildings/expenses";

type Context = { params?: Record<string, string> | Promise<Record<string, string>> };

/** PUT /api/buildings/[id]/expenses/[expenseId] — the expense and every unit's part, rewritten. */
async function handlePut(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const params = await context?.params;
  if (!params?.id || !params.expenseId) {
    return createErrorResponse(new Error("Invalid request: missing id"), 400, request);
  }
  const body = await parseJsonBody(request, buildingExpenseSchema);
  try {
    return createSuccessResponse(
      await updateBuildingExpense(authResult.userId, params.id, params.expenseId, body),
    );
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

/** DELETE /api/buildings/[id]/expenses/[expenseId] — the expense and its parts. */
async function handleDelete(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const params = await context?.params;
  if (!params?.id || !params.expenseId) {
    return createErrorResponse(new Error("Invalid request: missing id"), 400, request);
  }
  try {
    await deleteBuildingExpense(authResult.userId, params.id, params.expenseId);
    return createSuccessResponse({ deleted: true });
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

export const PUT = withErrorHandler(handlePut);
export const DELETE = withErrorHandler(handleDelete);
export const OPTIONS = handleOptions;
