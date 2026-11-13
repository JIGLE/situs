import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseJsonBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { buildingExpenseSchema } from "@/lib/schemas/building-expense.schema";
import { createBuildingExpense, listBuildingExpenses } from "@/lib/services/buildings/expenses";

type Context = { params?: Record<string, string> | Promise<Record<string, string>> };

/** GET /api/buildings/[id]/expenses — the building's shared expenses, each with its parts. */
async function handleGet(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const id = (await context?.params)?.id;
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);
  try {
    return createSuccessResponse(await listBuildingExpenses(authResult.userId, id));
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

/**
 * POST /api/buildings/[id]/expenses — records a shared cost and writes each unit's part as an
 * expense of that unit (`lib/services/buildings/expenses.ts`).
 */
async function handlePost(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const id = (await context?.params)?.id;
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);
  const body = await parseJsonBody(request, buildingExpenseSchema);
  try {
    return createSuccessResponse(await createBuildingExpense(authResult.userId, id, body), 201);
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

export const GET = withErrorHandler(handleGet);
export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
