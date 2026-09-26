import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { getRentMatrix } from "@/lib/services/allocation/rent-matrix";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * Situs Rent Matrix read model: for a given year, every lease's 12 reference months, with each
 * month's status worked out as of now (`lib/services/allocation/rent-matrix.ts`), what is still
 * owed, and totals.
 */
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const url = new URL(request.url);
  const yearParam = Number(url.searchParams.get("year"));
  const year =
    Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
      ? yearParam
      : new Date().getUTCFullYear();

  return createSuccessResponse(await getRentMatrix(scopeUserId, year));
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
