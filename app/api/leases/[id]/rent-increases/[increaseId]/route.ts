import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { cancelRentIncrease } from "@/lib/services/leases/rent-increases";

/** Withdraw a rent increase that has not started. One that has is part of the rent's history. */
async function handleDelete(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const params = context?.params instanceof Promise ? await context.params : context?.params;
  const leaseId = params?.id;
  const increaseId = params?.increaseId;
  if (!leaseId || !increaseId) {
    return createErrorResponse(new Error("Invalid request: missing id"), 400, request);
  }

  await cancelRentIncrease(userId, leaseId, increaseId);
  return createSuccessResponse({ cancelled: increaseId });
}

export const DELETE = withErrorHandler(handleDelete);
export const OPTIONS = handleOptions;
