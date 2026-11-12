import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { placeMissingProperties } from "@/lib/services/geocoding/property-coordinates";

/**
 * POST /api/properties/geocode — places a few of the caller's properties that have an address and
 * no coordinates, for the Portfolio map (`lib/services/geocoding/`). It takes no body: what to
 * place is read from the caller's own properties. The addresses go to OpenStreetMap's Nominatim;
 * nothing else about the property does.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  try {
    const result = await placeMissingProperties(authResult.userId);
    return createSuccessResponse(result);
  } catch (error) {
    // Nominatim unreachable or refusing: the map shows what it has, so this is not the app failing.
    return createErrorResponse(error as Error, 502, request);
  }
}

export const POST = withErrorHandler(handlePost);
export const OPTIONS = handleOptions;
