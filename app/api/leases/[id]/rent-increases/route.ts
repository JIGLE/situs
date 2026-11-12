import { NextRequest } from "next/server";
import { z } from "zod";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  readJson,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { scheduleRentIncrease } from "@/lib/services/leases/rent-increases";
import { fromMonthValue } from "@/lib/utils/rent-increase";

/**
 * A rent increase decided ahead: the month the new rent starts, the percentage, and when the
 * written notice went out. The new rent is computed here from the lease's current rent.
 */
const rentIncreaseSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}$/, "effectiveFrom must be YYYY-MM"),
  percent: z.number().positive().max(100),
  noticeDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "noticeDate must be YYYY-MM-DD")
    .nullish(),
});

async function handlePost(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const params = context?.params instanceof Promise ? await context.params : context?.params;
  const leaseId = params?.id;
  if (!leaseId) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  const body = parseBody(await readJson(request), rentIncreaseSchema);
  const effectiveFrom = fromMonthValue(body.effectiveFrom);
  if (!effectiveFrom) {
    return createErrorResponse(new Error("effectiveFrom is not a month"), 400, request);
  }

  const increase = await scheduleRentIncrease(userId, leaseId, {
    effectiveFrom,
    percent: body.percent,
    noticeDate: body.noticeDate ? new Date(`${body.noticeDate}T00:00:00.000Z`) : null,
  });
  return createSuccessResponse(increase, 201);
}

export const POST = withErrorHandler(handlePost);
export const OPTIONS = handleOptions;
