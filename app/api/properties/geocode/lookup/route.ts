import { NextRequest } from "next/server";
import { z } from "zod";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseJsonBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { locate } from "@/lib/services/geocoding/nominatim";

const lookupBody = z.object({
  address: z.string().trim().min(1).max(200),
  streetAddress: z.string().max(200).nullish(),
  city: z.string().max(100).nullish(),
  zipCode: z.string().max(20).nullish(),
});

/**
 * POST /api/properties/geocode/lookup — where an address is on the map, for the property form
 * before it saves: `{ found: { latitude, longitude, precision, displayName } }`, or
 * `{ found: null }` when Nominatim places it nowhere. Only the address goes to Nominatim.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const body = await parseJsonBody(request, lookupBody);
  try {
    const found = await locate(body);
    return createSuccessResponse({ found });
  } catch (error) {
    // Nominatim unreachable: says nothing about the address, so the form does not refuse it.
    return createErrorResponse(error as Error, 502, request);
  }
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
