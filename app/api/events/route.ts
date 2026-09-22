import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { isMockMode } from "@/lib/config/data-mode";
import { recordProductEvent, PRODUCT_EVENT_NAMES } from "@/lib/services/analytics/product-events";
import { createSuccessResponse, parseJsonBody, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

const eventSchema = z.object({
  name: z.enum(PRODUCT_EVENT_NAMES),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// POST /api/events - Record a client-side product-analytics event.
// Mock mode is intentionally a no-op: there is no database to write to.
async function handlePost(request: NextRequest): Promise<Response> {
  if (isMockMode) {
    return createSuccessResponse({ ok: true });
  }

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const body = await parseJsonBody(request, eventSchema);

  const prisma = getPrismaClient();
  await recordProductEvent(prisma, userId, body.name, body.metadata);

  return createSuccessResponse({ ok: true });
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
