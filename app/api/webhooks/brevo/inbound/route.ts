/**
 * Brevo Inbound Parsing webhook — mail from the outside world.
 *
 * Brevo POSTs `{ items: [...] }` when a message arrives at an address whose MX points at them.
 * See `lib/services/inbound/parse.ts` for the payload shape.
 *
 * SECURITY: BREVO DOES NOT SIGN THIS EITHER.
 *
 * Same absence as the delivery-event webhook next door, but a much larger blast radius. That
 * route can only write delivery metadata onto `EmailLog`. This one writes message bodies, and
 * spends outbound API calls fetching attachments onto our disk. So:
 *
 *   - It takes its OWN secret, `BREVO_INBOUND_SECRET`, never the event webhook's. Two routes
 *     with different consequences should not share one credential; leaking the weaker one must
 *     not hand over the stronger.
 *   - It is rate-limited on top of the secret, because a secret bounds *who* can call it and
 *     not *how often* — and every call here can mean a disk write.
 *   - Nothing it stores is trusted. The `From` header is recorded, never believed: see the note
 *     on `InboundMessage` and the deliberately-weak matcher in `lib/services/inbound/matching.ts`.
 */

import { NextRequest, NextResponse } from "next/server";

import { ingestMessages } from "@/lib/services/inbound/ingest";
import { normaliseItem, readItems } from "@/lib/services/inbound/parse";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { isWebhookAuthorised } from "@/lib/utils/webhook-auth";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";

const log = logger.child({ component: "brevo-inbound" });

/**
 * Cap on one delivery. Brevo posts a small batch; anything near this is either a fault on their
 * side or someone with the secret trying to make us do unbounded work.
 */
const MAX_ITEMS = 25;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = checkRateLimit(request);
  if (limited) return limited as NextResponse;

  if (!process.env.BREVO_INBOUND_SECRET) {
    // 503, not 401: the instance is unconfigured, the caller is not wrong. Same distinction the
    // /api/cron/* routes draw, and it is what stops an operator debugging Brevo credentials when
    // the problem is their own env file.
    return NextResponse.json({ error: "Inbound parsing not configured" }, { status: 503 });
  }

  if (!isWebhookAuthorised(request, process.env.BREVO_INBOUND_SECRET)) {
    log.warn("Rejected an unauthorised inbound delivery");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const items = readItems(body);
  if (items.length > MAX_ITEMS) {
    log.warn("Truncated an oversized inbound batch", { received: items.length, max: MAX_ITEMS });
  }

  const messages = items
    .slice(0, MAX_ITEMS)
    .filter((item): item is NonNullable<typeof item> => Boolean(item) && typeof item === "object")
    .map(normaliseItem)
    .filter((m): m is NonNullable<typeof m> => m !== null);

  const result = await ingestMessages(messages);

  log.info("Processed an inbound batch", { ...result, received: items.length });

  // Always 2xx once authorised. A non-2xx makes Brevo redeliver the whole batch, re-running the
  // messages that did land — and only those carrying a Message-ID would be caught by the dedupe.
  return NextResponse.json({ received: messages.length, ...result });
}
