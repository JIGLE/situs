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
import { reverseGeocode } from "@/lib/services/geocoding/nominatim";

const reverseBody = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/**
 * POST /api/properties/geocode/reverse — the address at a point the owner put a pin on, for the
 * property form to offer: `{ address: { streetAddress, zipCode, city, displayName } | null }`.
 * Only the point goes to Nominatim.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const point = await parseJsonBody(request, reverseBody);
  try {
    return createSuccessResponse({ address: await reverseGeocode(point) });
  } catch (error) {
    return createErrorResponse(error as Error, 502, request);
  }
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
