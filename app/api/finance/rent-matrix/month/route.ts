import { NextRequest } from "next/server";
import { z } from "zod";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { getRentMonth } from "@/lib/services/allocation/rent-matrix";
import {
  ResourceNotFoundError,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

const monthQuerySchema = z.object({
  leaseId: z.string().min(1).max(64),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

// GET /api/finance/rent-matrix/month?leaseId=&year=&month= — one lease's month, for the sheet.
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const params = new URL(request.url).searchParams;
  const query = parseBody(
    {
      leaseId: params.get("leaseId") ?? "",
      year: Number(params.get("year")),
      month: Number(params.get("month")),
    },
    monthQuerySchema,
  );

  const result = await getRentMonth(scopeUserId, query.leaseId, query.year, query.month);
  // Another owner's lease reads exactly as one that does not exist.
  if (!result) throw new ResourceNotFoundError("Lease");
  return createSuccessResponse(result);
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
