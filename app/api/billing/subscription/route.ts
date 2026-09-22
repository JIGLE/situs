/**
 * Billing Subscription API
 * GET /api/billing/subscription - the signed-in user's plan, status, and property usage
 */
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getCurrentPlanInfo } from "@/lib/billing/subscription-service";
import { isEnabled } from "@/lib/utils/env";

async function handleGet(request: NextRequest): Promise<Response> {
  // Self-hosted instances don't enforce or sell subscriptions unless the
  // operator opts in with ENABLE_BILLING. Surface that so the client can hide
  // all subscription framing (Billing tab, plan badges, upgrade prompts) when
  // it's off — the account is effectively unlimited.
  const billingEnabled = isEnabled("ENABLE_BILLING");

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const prisma = getPrismaClient();
  const info = await getCurrentPlanInfo(prisma, userId);

  return createSuccessResponse({ ...info, billingEnabled });
}

export const GET = withErrorHandler(withRateLimit(handleGet));
