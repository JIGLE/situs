import { NextRequest } from "next/server";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { generateDueRecurringExpenses } from "@/lib/services/expenses/recurring";

/**
 * GET /api/expenses/recurring
 * List all recurring template expenses (isRecurring=true, parentExpenseId=null)
 * for the authenticated user.
 */
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  const templates = await prisma.expense.findMany({
    where: {
      userId,
      isRecurring: true,
      parentExpenseId: null,
    },
    orderBy: { date: "desc" },
    include: {
      property: {
        select: { name: true },
      },
    },
  });

  const transformed = templates.map((e) => ({
    ...e,
    propertyName: e.property.name,
  }));

  return createSuccessResponse(transformed);
}

/**
 * POST /api/expenses/recurring
 * Make the copies of the caller's recurring expenses that have fallen due
 * (`generateDueRecurringExpenses`). `GET /api/expenses` and the daily cron do the same.
 *
 * Returns: { generated: number }
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const generated = await generateDueRecurringExpenses(authResult.userId);
  return createSuccessResponse({ generated });
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
