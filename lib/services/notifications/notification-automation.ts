/**
 * Notification Automation Service
 *
 * Automated triggers for:
 * - Rent payment reminders (D-5 before due date)
 * - Overdue payment notices (D+1 and D+7)
 * - Lease renewal reminders (D-60 before expiration)
 * - Recibo de Renda deadline reminders (D+5 after payment, PT only)
 *
 * Each trigger writes the in-app Notification row AND (see ./reminder-email)
 * sends the same reminder as a localized email, gated on the landlord's own
 * UserSettings.emailNotifications/.taxReminderNotifications preference — the
 * email inherits the in-app notification's existing per-entity dedup check,
 * so it's sent exactly once per entity, same as the notification is.
 *
 * WHAT THESE READ FROM. Three of the four used to be driven by the tenant-facing
 * payment stack: `Invoice.dueDate` for the two payment alerts, and a succeeded
 * `PaymentTransaction` for the receipt deadline. The scope cutdown removed that
 * stack, so they now read the reference-month rent ledger, which is where rent is
 * actually owed and paid in this app:
 *
 *   - money OWED is a `RentPeriod` — one row per lease per reference month, with
 *     `dueAmount` snapshotted at generation and `allocatedAmount` materialized from
 *     its non-reversed allocations;
 *   - money RECEIVED is a `PaymentAllocation` — written in the same transaction that
 *     moves the period's status, so `allocatedAt` is when the money landed;
 *   - the document the PT deadline is about is a `RentReceipt` (recibo de renda), the
 *     fiscal filing, not the internal `Receipt`.
 *
 * Had they simply been deleted with the payment stack, the bell would have kept
 * working while silently emitting only one of its four alert types.
 *
 * Designed to be called from a cron endpoint (e.g., /api/cron/notifications)
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { logger } from "@/lib/utils/logger";
import { MONEY_EPSILON } from "@/lib/utils/money";
import { sendReminderEmail, resetReminderEmailCache } from "./reminder-email";

const log = logger.child("notification-automation");

/**
 * RentPeriod statuses meaning nothing more is owed, so no payment alert applies.
 *
 * `waived` is in the schema's status comment and rendered by the rent matrix and the
 * property year strip, but missing from the `RentPeriodStatus` union in
 * lib/services/allocation/types.ts. Leaving it out here would chase a landlord for rent
 * they had deliberately written off, so it is listed explicitly rather than derived
 * from that type.
 */
const SETTLED_PERIOD_STATUSES = ["paid", "paid_late", "waived"];

/** Outstanding balance on a period, guarding against float drift on exact payments. */
function outstanding(period: { dueAmount: number; allocatedAmount: number }): number {
  return period.dueAmount - period.allocatedAmount;
}

/** Start and end of the calendar day `offsetDays` from now. */
function dayWindow(offsetDays: number): { start: Date; end: Date } {
  const target = new Date();
  target.setDate(target.getDate() + offsetDays);
  const start = new Date(target);
  start.setHours(0, 0, 0, 0);
  const end = new Date(target);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

interface AutomationResult {
  rentReminders: number;
  overdueNotices: number;
  leaseRenewals: number;
  receiptReminders: number;
  errors: string[];
}

/**
 * Generate rent payment reminders for reference months falling due in 5 days.
 *
 * The reminder quotes what is still OUTSTANDING rather than the period's full
 * `dueAmount`: a period carrying a part payment is still worth chasing, but for the
 * balance, not the original rent.
 */
async function generateRentReminders(prisma: ReturnType<typeof getPrismaClient>): Promise<number> {
  const { start, end } = dayWindow(5);

  const upcomingPeriods = await prisma.rentPeriod.findMany({
    where: {
      dueDate: { gte: start, lte: end },
      status: { notIn: SETTLED_PERIOD_STATUSES },
    },
    include: {
      tenant: true,
      property: true,
    },
  });

  let created = 0;
  for (const period of upcomingPeriods) {
    const owed = outstanding(period);
    // A period can sit in an unsettled status with nothing left on it while the
    // status recompute catches up. Nothing to chase.
    if (owed <= MONEY_EPSILON) continue;

    // Check if a reminder was already created for this period
    const existing = await prisma.notification.findFirst({
      where: {
        userId: period.userId,
        type: "payment_due",
        entityType: "RentPeriod",
        entityId: period.id,
      },
    });
    if (existing) continue;

    const tenantName = period.tenant?.name ?? "Tenant";
    const propertyAddr = period.property?.address ?? "Property";

    const amount = `€${owed.toFixed(2)}`;
    const date = period.dueDate.toLocaleDateString("pt-PT");

    await prisma.notification.create({
      data: {
        userId: period.userId,
        type: "payment_due",
        title: `Rent payment due in 5 days`,
        message: `Payment of ${amount} from ${tenantName} for ${propertyAddr} is due on ${date}.`,
        entityType: "RentPeriod",
        entityId: period.id,
      },
    });
    await sendReminderEmail(prisma, period.userId, "rentReminder", {
      tenant: tenantName,
      property: propertyAddr,
      amount,
      date,
    });
    created++;
  }
  return created;
}

/**
 * Generate overdue payment notices (D+1 and D+7)
 *
 * Reads the ledger rather than the period's `overdue` status: a part-paid period sits
 * at `partially_paid`, not `overdue`, and the balance on it is still late.
 */
async function generateOverdueNotices(prisma: ReturnType<typeof getPrismaClient>): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overduePeriods = await prisma.rentPeriod.findMany({
    where: {
      dueDate: { lt: today },
      status: { notIn: SETTLED_PERIOD_STATUSES },
    },
    include: {
      tenant: true,
      property: true,
    },
  });

  let created = 0;
  for (const period of overduePeriods) {
    const owed = outstanding(period);
    if (owed <= MONEY_EPSILON) continue;

    const daysPastDue = Math.floor(
      (today.getTime() - new Date(period.dueDate).getTime()) / (1000 * 60 * 60 * 24),
    );

    // Only send at D+1 and D+7
    if (daysPastDue !== 1 && daysPastDue !== 7) continue;

    const suffix = daysPastDue === 1 ? "1 day" : "7 days";

    // Check if this specific overdue notice was already sent
    const existing = await prisma.notification.findFirst({
      where: {
        userId: period.userId,
        type: "payment_overdue",
        entityType: "RentPeriod",
        entityId: period.id,
        message: { contains: suffix },
      },
    });
    if (existing) continue;

    const tenantName = period.tenant?.name ?? "Tenant";
    const propertyAddr = period.property?.address ?? "Property";

    const amount = `€${owed.toFixed(2)}`;

    await prisma.notification.create({
      data: {
        userId: period.userId,
        type: "payment_overdue",
        title: `Payment overdue by ${suffix}`,
        message: `Payment of ${amount} from ${tenantName} for ${propertyAddr} is overdue by ${suffix}.`,
        entityType: "RentPeriod",
        entityId: period.id,
      },
    });
    await sendReminderEmail(prisma, period.userId, "overdueNotice", {
      tenant: tenantName,
      property: propertyAddr,
      amount,
      days: daysPastDue,
    });
    created++;
  }
  return created;
}

/**
 * Generate lease renewal reminders (D-60 before expiration)
 */
async function generateLeaseRenewalReminders(
  prisma: ReturnType<typeof getPrismaClient>,
): Promise<number> {
  const now = new Date();
  const sixtyDaysFromNow = new Date(now);
  sixtyDaysFromNow.setDate(sixtyDaysFromNow.getDate() + 60);

  const startOfTargetDay = new Date(sixtyDaysFromNow);
  startOfTargetDay.setHours(0, 0, 0, 0);
  const endOfTargetDay = new Date(sixtyDaysFromNow);
  endOfTargetDay.setHours(23, 59, 59, 999);

  const expiringLeases = await prisma.lease.findMany({
    where: {
      endDate: { gte: startOfTargetDay, lte: endOfTargetDay },
      status: "active",
    },
    include: {
      tenant: true,
      property: true,
    },
  });

  let created = 0;
  for (const lease of expiringLeases) {
    // Check if reminder already sent
    const existing = await prisma.notification.findFirst({
      where: {
        userId: lease.userId,
        type: "lease_renewal_reminder",
        entityType: "Lease",
        entityId: lease.id,
      },
    });
    if (existing) continue;

    const tenantName = lease.tenant?.name ?? "Tenant";
    const propertyAddr = lease.property?.address ?? "Property";

    const date = lease.endDate.toLocaleDateString("pt-PT");

    await prisma.notification.create({
      data: {
        userId: lease.userId,
        type: "lease_renewal_reminder",
        title: "Lease expiring in 60 days",
        message: `Lease for ${tenantName} at ${propertyAddr} expires on ${date}. Consider renewal or sending notice.`,
        entityType: "Lease",
        entityId: lease.id,
      },
    });
    await sendReminderEmail(prisma, lease.userId, "leaseRenewal", {
      tenant: tenantName,
      property: propertyAddr,
      date,
    });
    created++;
  }
  return created;
}

/**
 * Generate Recibo de Renda deadline reminders (Portugal only)
 *
 * Portuguese law requires a rent receipt within 5 days of payment. This fires for money
 * received 4 days ago that still has no recibo, leaving one day to issue it.
 *
 * "Money received" is a non-reversed `PaymentAllocation`: allocation is what the bank
 * matching pipeline writes when a movement is attributed to a reference month, in the
 * same transaction that moves the period's status, so `allocatedAt` is when the money
 * landed on the ledger. A reversed allocation is one that was undone — voiding a receipt
 * soft-reverses its allocations — and chasing a receipt for money that was taken back
 * would be wrong.
 *
 * The document being chased is a `RentReceipt` (the fiscal recibo filed with the AT),
 * not the internal `Receipt` that tracks the money. Scoping the check to the allocation's
 * own reference month is narrower than the date-window match this replaces, which could
 * be satisfied by any filing for the same tenant and property that happened to land in
 * the same day's window.
 */
async function generateReceiptDeadlineReminders(
  prisma: ReturnType<typeof getPrismaClient>,
): Promise<number> {
  const { start: startOfTargetDay, end: endOfTargetDay } = dayWindow(-4);

  const allocations = await prisma.paymentAllocation.findMany({
    where: {
      reversedAt: null,
      allocatedAt: { gte: startOfTargetDay, lte: endOfTargetDay },
    },
    include: {
      rentPeriod: {
        include: {
          tenant: true,
          property: true,
          rentReceiptFilings: { select: { id: true } },
        },
      },
    },
  });

  let created = 0;
  for (const allocation of allocations) {
    const period = allocation.rentPeriod;
    if (!period?.property) continue;

    // A recibo already filed for this reference month discharges the obligation.
    if (period.rentReceiptFilings.length > 0) continue;

    // Check if reminder already sent
    const existing = await prisma.notification.findFirst({
      where: {
        userId: allocation.userId,
        type: "rent_receipt_due",
        entityType: "PaymentAllocation",
        entityId: allocation.id,
      },
    });
    if (existing) continue;

    const tenantName = period.tenant?.name ?? "Tenant";
    const propertyAddr = period.property.address ?? "Property";

    const amount = `€${allocation.amount.toFixed(2)}`;

    await prisma.notification.create({
      data: {
        userId: allocation.userId,
        type: "rent_receipt_due",
        title: "Recibo de renda deadline tomorrow",
        message: `A rent receipt for ${tenantName} at ${propertyAddr} (payment of ${amount}) must be issued by tomorrow to meet the 5-day legal deadline.`,
        entityType: "PaymentAllocation",
        entityId: allocation.id,
      },
    });
    await sendReminderEmail(
      prisma,
      allocation.userId,
      "receiptDeadline",
      { tenant: tenantName, property: propertyAddr, amount },
      { gate: "tax" },
    );
    created++;
  }
  return created;
}

/**
 * Run all automated notification checks.
 * Call this from a cron endpoint (daily at ~08:00 local time recommended).
 */
export async function runNotificationAutomation(): Promise<AutomationResult> {
  const prisma = getPrismaClient();
  resetReminderEmailCache();
  const errors: string[] = [];
  let rentReminders = 0;
  let overdueNotices = 0;
  let leaseRenewals = 0;
  let receiptReminders = 0;

  try {
    rentReminders = await generateRentReminders(prisma);
  } catch (e) {
    const msg = `Rent reminders failed: ${(e as Error).message}`;
    log.error(msg);
    errors.push(msg);
  }

  try {
    overdueNotices = await generateOverdueNotices(prisma);
  } catch (e) {
    const msg = `Overdue notices failed: ${(e as Error).message}`;
    log.error(msg);
    errors.push(msg);
  }

  try {
    leaseRenewals = await generateLeaseRenewalReminders(prisma);
  } catch (e) {
    const msg = `Lease renewal reminders failed: ${(e as Error).message}`;
    log.error(msg);
    errors.push(msg);
  }

  try {
    receiptReminders = await generateReceiptDeadlineReminders(prisma);
  } catch (e) {
    const msg = `Receipt deadline reminders failed: ${(e as Error).message}`;
    log.error(msg);
    errors.push(msg);
  }

  const result = {
    rentReminders,
    overdueNotices,
    leaseRenewals,
    receiptReminders,
    errors,
  };
  log.info("Notification automation completed", result);
  return result;
}
