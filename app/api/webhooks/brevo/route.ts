/**
 * Brevo delivery-event webhook.
 *
 * Replaces the SendGrid event webhook. It reports the same things — delivered, bounced,
 * opened, blocked — under different names, and with a materially weaker security model that
 * this route has to compensate for.
 *
 * SECURITY: BREVO DOES NOT SIGN ITS WEBHOOKS.
 *
 * SendGrid signed every request with ECDSA and the old route verified it against
 * `SENDGRID_WEBHOOK_PUBLIC_KEY`. Brevo offers no signature, no HMAC and no timestamped
 * digest — their documented options are a secret in a header, an unguessable URL, or an IP
 * allowlist. So this route requires a shared secret and compares it in constant time, the same
 * shape as the `/api/cron/*` endpoints already use.
 *
 * The consequence worth being explicit about: a leaked `BREVO_WEBHOOK_SECRET` lets anyone
 * write email-status rows. That is the ceiling of the damage — this route only ever updates
 * delivery metadata on `EmailLog` — but it is a real downgrade from a signature, and it is why
 * the secret is mandatory here rather than optional. The old route logged a warning and
 * carried on when its public key was unset; this one refuses.
 */

import { NextRequest, NextResponse } from "next/server";

import { getPrismaClient } from "@/lib/services/database/database";
import { isWebhookAuthorised } from "@/lib/utils/webhook-auth";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";

const log = logger.child({ component: "brevo-webhook" });

/**
 * One event as Brevo posts it. Everything here is attacker-controlled in the sense that we
 * cannot cryptographically attribute it, so every field is treated as untrusted text.
 */
interface BrevoEvent {
  event?: string;
  email?: string;
  /** Brevo's own message id, matching what the SMTP send returned. */
  "message-id"?: string;
  messageId?: string;
  /** Unix seconds. */
  ts?: number;
  date?: string;
  reason?: string;
  subject?: string;
}

/**
 * Brevo's event vocabulary mapped onto the statuses `EmailLog` already stores, so the existing
 * email log UI keeps working unchanged.
 *
 * Both bounce kinds collapse to "bounced" deliberately: the distinction between a mailbox that
 * is full and one that does not exist matters to a deliverability team, and this is a landlord
 * looking at whether a rent reminder arrived.
 */
const EVENT_STATUS: Record<string, string> = {
  request: "sent",
  delivered: "delivered",
  deferred: "deferred",
  hardBounce: "bounced",
  softBounce: "bounced",
  blocked: "failed",
  spam: "failed",
  invalid_email: "failed",
  error: "failed",
  opened: "opened",
  uniqueOpened: "opened",
  click: "clicked",
  unsubscribed: "unsubscribed",
};

function eventTimestamp(event: BrevoEvent): Date {
  if (typeof event.ts === "number" && Number.isFinite(event.ts)) {
    return new Date(event.ts * 1000);
  }
  if (typeof event.date === "string") {
    const parsed = new Date(event.date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

async function processEvent(event: BrevoEvent): Promise<void> {
  const prisma = getPrismaClient();

  // Truncated because these are remote-controlled strings landing in our database.
  const email = typeof event.email === "string" ? event.email.slice(0, 255) : "";
  const reason = typeof event.reason === "string" ? event.reason.slice(0, 500) : undefined;
  const eventName = typeof event.event === "string" ? event.event.slice(0, 64) : "";

  const messageId = String(event["message-id"] ?? event.messageId ?? "").trim();
  if (!messageId) {
    log.debug("Event carries no message id; nothing to correlate", { event: eventName });
    return;
  }

  const status = EVENT_STATUS[eventName] ?? "unknown";

  try {
    await prisma.emailLog.upsert({
      // Column name is historical. It holds whichever provider's message id sent the mail —
      // renaming it is a migration against live rows and is deliberately not bundled here.
      where: { sendgridMessageId: messageId.slice(0, 255) },
      update: {
        status,
        lastEventAt: eventTimestamp(event),
        lastEventType: eventName,
        ...(reason && { failureReason: reason }),
      },
      create: {
        to: email,
        from: process.env.FROM_EMAIL ?? "noreply@situs.local",
        subject: typeof event.subject === "string" ? event.subject.slice(0, 255) : "[Webhook]",
        sendgridMessageId: messageId.slice(0, 255),
        status,
        lastEventAt: eventTimestamp(event),
        lastEventType: eventName,
        ...(reason && { failureReason: reason }),
      },
    });
  } catch (error) {
    // Logged and swallowed per event: one malformed event must not cost us the rest of a batch,
    // and a non-2xx makes Brevo retry the whole batch including the events that did land.
    log.error("Failed to process event", {
      event: eventName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!process.env.BREVO_WEBHOOK_SECRET) {
    // 503 rather than 401: this is the instance being unconfigured, not the caller being wrong.
    // Matches how /api/cron/* answers when CRON_SECRET is unset.
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  if (!isWebhookAuthorised(request, process.env.BREVO_WEBHOOK_SECRET)) {
    log.warn("Rejected an unauthorised webhook delivery");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Brevo posts a single event; a batch is accepted too so a future change of theirs does not
  // silently drop deliveries.
  const events: BrevoEvent[] = Array.isArray(body) ? body : [body as BrevoEvent];

  // Capped so an oversized payload cannot turn into an unbounded write loop.
  const MAX_EVENTS = 100;
  for (const event of events.slice(0, MAX_EVENTS)) {
    if (event && typeof event === "object") await processEvent(event);
  }

  if (events.length > MAX_EVENTS) {
    log.warn("Truncated an oversized event batch", { received: events.length, max: MAX_EVENTS });
  }

  return NextResponse.json({ received: Math.min(events.length, MAX_EVENTS) });
}
