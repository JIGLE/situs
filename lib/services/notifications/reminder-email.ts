/**
 * Email dispatch for the automated reminder notifications.
 *
 * lib/services/notifications/notification-automation.ts generates rent,
 * overdue, lease-renewal, and recibo-de-renda deadline reminders, but until
 * now only ever wrote an in-app Notification row — the reminder never left
 * the app, so a landlord who wasn't already looking at the dashboard had no
 * way to be pulled back in. This module sends the same reminder as a
 * localized email through the existing mail layer (lib/services/email, SMTP),
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
import enMessages from "@/messages/en.json";
import ptMessages from "@/messages/pt.json";
import esMessages from "@/messages/es.json";
import itMessages from "@/messages/it.json";

const log = logger.child("reminder-email");

const MESSAGES = { en: enMessages, pt: ptMessages, es: esMessages, it: itMessages } as const;
type SupportedLocale = keyof typeof MESSAGES;

/**
 * The landlord's saved language, else Portuguese, the app's own default. This fell back to
 * English, and so did the column's default, while every screen defaulted to Portuguese: an owner
 * who never chose a language read the app in one and their reminders in the other.
 */
function resolveLocale(language: string | null | undefined): SupportedLocale {
  return language && language in MESSAGES ? (language as SupportedLocale) : "pt";
}

export type ReminderEmailKind =
  "rentReminder" | "overdueNotice" | "leaseRenewal" | "receiptDeadline";

/**
 * Which reminder kinds are urgent enough to also leave the app as an email.
 *
 * In-app is always primary: every kind here still writes its Notification row
 * unconditionally, right where notification-automation.ts calls this function. This only
 * decides whether it ALSO reaches the landlord's inbox, on top of the emailNotifications /
 * taxReminderNotifications checks below.
 *
 * rentReminder (D-5) and leaseRenewal (D-60) both have days of runway before anything is
 * actually due, so the bell is enough to catch someone who checks the app now and then.
 * overdueNotice (money already late) and receiptDeadline (a legal filing deadline tomorrow)
 * have no such runway, so they still page the inbox.
 */
const URGENT_REMINDER_KINDS: ReadonlySet<ReminderEmailKind> = new Set([
  "overdueNotice",
  "receiptDeadline",
]);

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
  if (!URGENT_REMINDER_KINDS.has(kind)) return;

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
