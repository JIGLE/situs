/**
 * Lightweight product-analytics event sink.
 *
 * Before this, the app had a landing-page acquisition funnel
 * (components/shared/landing-analytics.tsx → /api/monitoring/track,
 * anonymous, in-memory) but no in-app product analytics — there was no way
 * to see whether the core loop (activation → rent collected → receipt
 * issued) was actually happening, or whether a reminder pulled anyone back
 * in. This is deliberately a generic (name + JSON metadata) sink rather than
 * a table per event, because most of the core-loop facts are already
 * derivable retroactively from existing tables — see
 * lib/services/analytics/activation-summary.ts, which computes activation
 * timing, on-time payment rate, and receipt-issuance rate directly from
 * Property/Tenant/Lease/Receipt/Invoice/RentReceipt without needing this
 * table at all. This sink exists for signals that have no other home, e.g.
 * "a reminder notification was clicked" (distinct from "marked read" via a
 * bulk action, which the Notification table already captures).
 */

import type { getPrismaClient } from "@/lib/services/database/database";
import { logger } from "@/lib/utils/logger";

const log = logger.child("product-events");

export const PRODUCT_EVENT_NAMES = ["reminder_clicked"] as const;
export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

/**
 * Records a product event. Never throws — analytics must not be able to
 * break the user-facing action it's attached to.
 */
export async function recordProductEvent(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  name: ProductEventName,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.productEvent.create({
      data: {
        userId,
        name,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (e) {
    log.warn("Failed to record product event", {
      name,
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
