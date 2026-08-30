/**
 * Email dispatch for the automated reminder notifications.
 *
 * lib/services/notifications/notification-automation.ts generates rent,
 * overdue, lease-renewal, and recibo-de-renda deadline reminders, but until
 * now only ever wrote an in-app Notification row — the reminder never left
 * the app, so a landlord who wasn't already looking at the dashboard had no
 * way to be pulled back in. This module sends the same reminder as a
 * localized email via the existing SendGrid layer (lib/services/email),
 * gated on the landlord's own notification preferences
 * (UserSettings.emailNotifications / .taxReminderNotifications — already
 * modeled and editable in Settings, just never wired to an actual send).
 *
 * Deliberately NOT deduplicated here: callers only invoke this once per
 * entity, right where they already create the one-time Notification row
 * (guarded by an "already have a notification for this entity" check), so
 * the email inherits that same idempotency for free.
 */

import type { getPrismaClient } from "@/lib/services/database/database";
import { emailService } from "@/lib/services/email/email-service";
import { incrementEmailSent, incrementEmailFailed } from "@/app/api/metrics/route";
import { logger } from "@/lib/utils/logger";
import { t } from "@/lib/utils/format-message";
// Moved to `lib/services/email/email-locale.ts` when the portal invitation became a second
// consumer. Behaviour here is unchanged: these emails go to the landlord, so they resolve from
// `UserSettings.language`, which is what `resolveLocale` reads.
import { MESSAGES, resolveLocale, type SupportedLocale } from "@/lib/services/email/email-locale";

const log = logger.child("reminder-email");

export type ReminderEmailKind =
  "rentReminder" | "overdueNotice" | "leaseRenewal" | "receiptDeadline";

interface UserEmailContext {
  email: string;
  locale: SupportedLocale;
  emailNotifications: boolean;
  taxReminderNotifications: boolean;
}

// Per-run cache so N reminders for the same landlord don't refetch their
// user/settings row N times. Cleared at the start of each automation run.
const userContextCache = new Map<string, Promise<UserEmailContext | null>>();

/** Call once at the start of runNotificationAutomation(). */
export function resetReminderEmailCache(): void {
  userContextCache.clear();
}

async function getUserEmailContext(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
): Promise<UserEmailContext | null> {
  let pending = userContextCache.get(userId);
  if (!pending) {
    pending = (async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          settings: {
            select: {
              language: true,
              emailNotifications: true,
              taxReminderNotifications: true,
            },
          },
        },
      });
      if (!user) return null;
      return {
        email: user.email,
        locale: resolveLocale(user.settings?.language),
        emailNotifications: user.settings?.emailNotifications ?? true,
        taxReminderNotifications: user.settings?.taxReminderNotifications ?? true,
      };
    })();
    userContextCache.set(userId, pending);
  }
  return pending;
}

/**
 * Send one reminder email, respecting the landlord's notification
 * preferences. Never throws — a failed/skipped email must not stop the
 * caller's notification-creation loop or the wider automation run.
 */
export async function sendReminderEmail(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  kind: ReminderEmailKind,
  values: Record<string, string | number>,
  options?: { gate?: "tax" },
): Promise<void> {
  try {
    const ctx = await getUserEmailContext(prisma, userId);
    if (!ctx) return;
    if (!ctx.emailNotifications) return;
    if (options?.gate === "tax" && !ctx.taxReminderNotifications) return;

    const messages = MESSAGES[ctx.locale];
    const subject = t(messages, `notifications.email.${kind}.subject`, values);
    const body = t(messages, `notifications.email.${kind}.body`, values);
    const footer = t(messages, "notifications.email.footer");

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>${body}</p>
        <p style="color: #666; font-size: 12px; margin-top: 24px;">${footer}</p>
      </div>
    `;

    const result = await emailService.sendEmail(
      {
        to: ctx.email,
        from: process.env.FROM_EMAIL || "noreply@situs.app",
        subject,
        html,
        text: `${body}\n\n${footer}`,
      },
      userId,
    );

    if (result.success) {
      incrementEmailSent();
    } else {
      incrementEmailFailed();
      log.warn(`Reminder email not sent (${kind})`, { userId, error: result.error });
    }
  } catch (e) {
    incrementEmailFailed();
    log.error(`Reminder email failed (${kind})`, e, { userId });
  }
}
