import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import {
  createSuccessResponse,
  createErrorResponse,
  parseBody,
  parseJsonBody,
  ResourceNotFoundError,
} from "@/lib/utils/error-handling";
import { emailService } from "@/lib/services/email/email-service";
import { z } from "zod";

const querySchema = z.object({
  days: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 30)),
});

// A string, not whatever the body holds: the service finds the log with `findFirst`, which reads an
// object as a filter, so `{ "startsWith": "" }` would pick one of the caller's logs at random.
const retrySchema = z.object({ emailLogId: z.string().min(1, "emailLogId is required") });

/**
 * GET /api/email/metrics - Get comprehensive email delivery metrics
 *
 * Query params:
 * - days: Number of days to look back (default: 30)
 *
 * Returns:
 * - totalSent: Number of emails sent
 * - totalDelivered: Number of emails delivered
 * - totalFailed: Number of emails that failed
 * - totalBounced: Number of bounced emails
 * - totalOpened: Number of opened emails
 * - deliveryRate: Percentage of emails delivered
 * - openRate: Percentage of delivered emails that were opened
 * - bounceRate: Percentage of emails that bounced
 * - recentEmails: Last 10 emails sent
 */
export async function GET(request: NextRequest): Promise<Response | NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const query = parseBody(Object.fromEntries(searchParams), querySchema);

    // Get comprehensive metrics
    const [metrics, recentEmails] = await Promise.all([
      emailService.getEmailMetrics(authResult.userId, query.days),
      emailService.getRecentEmails(authResult.userId, 10),
    ]);

    return createSuccessResponse({
      metrics,
      recentEmails,
      isConfigured: emailService.isReady(),
    });
  } catch (error: unknown) {
    console.error("Email metrics error:", error);
    return createErrorResponse(
      error instanceof Error ? error : new Error("Failed to fetch email metrics"),
      500,
      request,
    );
  }
}

/**
 * POST /api/email/metrics - Retry a failed email
 *
 * Body:
 * - emailLogId: ID of the email log to retry. It has to be one of the caller's own: another
 *   account's log answers 404, the same as an id that does not exist.
 */
export async function POST(request: NextRequest): Promise<Response | NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  try {
    const { emailLogId } = await parseJsonBody(request, retrySchema);

    const result = await emailService.retryFailedEmail(emailLogId, authResult.userId);

    if (result.success) {
      return createSuccessResponse({ message: "Email retry initiated successfully" });
    }
    if (result.notFound) {
      return createErrorResponse(new ResourceNotFoundError("Email log"), 404, request);
    }
    return createErrorResponse(new Error(result.error || "Failed to retry email"), 400, request);
  } catch (error: unknown) {
    console.error("Email retry error:", error);
    return createErrorResponse(
      error instanceof Error ? error : new Error("Failed to retry email"),
      500,
      request,
    );
  }
}
