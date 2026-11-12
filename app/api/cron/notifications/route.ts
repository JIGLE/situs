/**
 * Cron endpoint for notification automation.
 *
 * Trigger daily via:
 * - Kubernetes CronJob: curl -H "Authorization: Bearer $CRON_SECRET" https://app/api/cron/notifications
 * - GitHub Actions: scheduled workflow
 * - Vercel Cron: vercel.json crons config
 *
 * Protected by CRON_SECRET env var to prevent unauthorized access.
 */

import { NextRequest, NextResponse } from "next/server";
import { runNotificationAutomation } from "@/lib/services/notifications/notification-automation";
import { timingSafeEqualString } from "@/lib/utils/security";
import { applyDueRentIncreases } from "@/lib/services/leases/rent-increases";
import { generateDueRecurringExpenses } from "@/lib/services/expenses/recurring";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Verify cron secret to prevent unauthorized triggers
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!timingSafeEqualString(token, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // A rent increase whose month has come is written onto its lease first, so tenants' rent and
    // the reminders read the rent now owed.
    const rentIncreasesApplied = await applyDueRentIncreases();
    const recurringExpensesCreated = await generateDueRecurringExpenses();
    const result = await runNotificationAutomation();
    return NextResponse.json({
      ok: true,
      rentIncreasesApplied,
      recurringExpensesCreated,
      ...result,
    });
  } catch (error) {
    console.error("Notification cron failed:", error);
    return NextResponse.json({ error: "Notification automation failed" }, { status: 500 });
  }
}

// Also support GET for simple cron services
export async function GET(request: NextRequest): Promise<NextResponse> {
  return POST(request);
}
