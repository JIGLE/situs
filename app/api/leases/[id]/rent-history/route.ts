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
import { rentHistory, settleRentBefore } from "@/lib/services/leases/rent-history";
import { fromMonthValue } from "@/lib/utils/rent-increase";

async function leaseIdOf(context?: {
  params?: Record<string, string> | Promise<Record<string, string>>;
}): Promise<string | undefined> {
  const params = context?.params instanceof Promise ? await context.params : context?.params;
  return params?.id;
}

/**
 * GET: the bank movements already in that look like this tenancy's rent, and the months still
 * owing, for the owner to say what was paid before the tenancy reached Situs.
 */
async function handleGet(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const leaseId = await leaseIdOf(context);
  if (!leaseId) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);
  return createSuccessResponse(await rentHistory(authResult.scopeUserId, leaseId));
}

const settleSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}$/, "from must be YYYY-MM"),
});

/** POST: the months before `from` were settled before Situs. */
async function handlePost(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const leaseId = await leaseIdOf(context);
  if (!leaseId) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  const body = parseBody(await readJson(request), settleSchema);
  const from = fromMonthValue(body.from);
  if (!from) return createErrorResponse(new Error("from is not a month"), 400, request);

  const settled = await settleRentBefore(authResult.scopeUserId, leaseId, from);
  return createSuccessResponse({ settled });
}

export const GET = withErrorHandler(handleGet);
export const POST = withErrorHandler(handlePost);
export const OPTIONS = handleOptions;
