import { NextRequest } from "next/server";

import { handleOptions, requireAdmin } from "@/lib/services/auth/auth-middleware";
import { updateSignUpSettings } from "@/lib/services/auth/sign-up";
import { signUpSettingsSchema } from "@/lib/schemas/admin-access.schema";
import {
  createSuccessResponse,
  parseBody,
  readJson,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * PUT /api/admin/access/settings — the two sign-up switches. They govern new accounts only: an
 * existing account signs in before either is read, so changing them locks nobody out.
 */
async function handlePut(request: NextRequest): Promise<Response> {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;

  const body = parseBody(await readJson(request), signUpSettingsSchema);
  return createSuccessResponse(await updateSignUpSettings(authResult.userId, body));
}

export const PUT = withErrorHandler(withRateLimit(handlePut));
export const OPTIONS = handleOptions;
