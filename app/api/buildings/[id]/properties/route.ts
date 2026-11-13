import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseJsonBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { buildingUnitsSchema } from "@/lib/schemas/building-expense.schema";
import { setBuildingUnits } from "@/lib/services/buildings/units";

type Context = { params?: Record<string, string> | Promise<Record<string, string>> };

/**
 * PUT /api/buildings/[id]/properties — the building's units, all of them, with each one's
 * permilagem (`lib/services/buildings/units.ts`). Properties left out leave the building.
 */
async function handlePut(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const id = (await context?.params)?.id;
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  const body = await parseJsonBody(request, buildingUnitsSchema);
  try {
    return createSuccessResponse(await setBuildingUnits(authResult.userId, id, body));
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

export const PUT = withErrorHandler(handlePut);
export const OPTIONS = handleOptions;
