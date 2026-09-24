import { NextRequest } from "next/server";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

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
 * Generate child expenses for the current month for all active recurring
 * templates that don't already have a child for this month.
 *
 * Returns: { generated: number, skipped: number, expenses: Expense[] }
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Find all active recurring templates for this user
  const templates = await prisma.expense.findMany({
    where: {
      userId,
      isRecurring: true,
      parentExpenseId: null,
      OR: [{ recurrenceEnd: null }, { recurrenceEnd: { gte: now } }],
    },
    include: {
      property: { select: { name: true } },
    },
  });

  const generated: typeof templates = [];
  let skipped = 0;

  for (const template of templates) {
    const rule = template.recurrenceRule ?? "monthly";

    // Determine if this template is due in the current month
    const isDue = isTemplateDueThisMonth(rule, currentMonth, template.date);
    if (!isDue) {
      skipped++;
      continue;
    }

    // Check whether a child already exists for this month/year
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);

    const existing = await prisma.expense.findFirst({
      where: {
        parentExpenseId: template.id,
        date: {
          gte: monthStart,
          lte: monthEnd,
        },
      },
    });

    if (existing) {
      skipped++;
      continue;
    }

    // Create the child expense for this month
    const day = template.recurrenceDay ?? 1;
    // Clamp day to valid range for the current month
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const clampedDay = Math.min(day, daysInMonth);
    const expenseDate = new Date(currentYear, currentMonth, clampedDay);

    const child = await prisma.expense.create({
      data: {
        userId,
        propertyId: template.propertyId,
        leaseId: template.leaseId ?? undefined,
        amount: template.amount,
        date: expenseDate,
        category: template.category,
        description: template.description ?? undefined,
        isDeductible: template.isDeductible,
        vendorName: template.vendorName ?? undefined,
        vendorVat: template.vendorVat ?? undefined,
        isRecurring: false,
        parentExpenseId: template.id,
      },
      include: {
        property: { select: { name: true } },
      },
    });

    generated.push(child);
  }

  const transformedGenerated = generated.map((e) => ({
    ...e,
    propertyName: e.property.name,
  }));

  return createSuccessResponse({
    generated: generated.length,
    skipped,
    expenses: transformedGenerated,
  });
}

/**
 * Determine if a recurring template is due in the current month based on its rule.
 * - monthly: always due
 * - quarterly: due if the template's original month falls in the same quarter cycle
 * - annual: due if the template's original month matches the current month
 */
function isTemplateDueThisMonth(rule: string, currentMonth: number, templateDate: Date): boolean {
  const templateMonth = new Date(templateDate).getMonth();

  switch (rule) {
    case "monthly":
      return true;
    case "quarterly": {
      // Due in months that are 3n offset from the template's month
      const monthDiff = (currentMonth - templateMonth + 12) % 12;
      return monthDiff % 3 === 0;
    }
    case "annual":
      return currentMonth === templateMonth;
    default:
      return false;
  }
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
