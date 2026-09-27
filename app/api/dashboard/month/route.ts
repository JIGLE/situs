import { NextRequest } from "next/server";
import { z } from "zod";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { getDashboardMonth } from "@/lib/services/dashboard/month";
import { createSuccessResponse, parseBody, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

const monthQuerySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

/**
 * GET /api/dashboard/month?year=&month= — the dashboard's month, assembled on the server from the
 * rent ledger (`lib/services/dashboard/month.ts`). Every figure is the owner's own.
 */
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const params = new URL(request.url).searchParams;
  const query = parseBody(
    { year: Number(params.get("year")), month: Number(params.get("month")) },
    monthQuerySchema,
  );

  return createSuccessResponse(await getDashboardMonth(scopeUserId, query.year, query.month));
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
