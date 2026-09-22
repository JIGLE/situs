// Stripe Webhook Handler - Process subscription-billing events
import { NextRequest, NextResponse } from "next/server";
import { processSubscriptionWebhook } from "@/lib/billing/subscription-service";
import { getStripeClient } from "@/lib/billing/stripe-client";
import { getSecret, isEnabled } from "@/lib/utils/env";
import { rateLimit, RateLimits } from "@/lib/middleware/rate-limit";
import Stripe from "stripe";

// The only Stripe events this app has anything to do with. It used to also route payment
// intents and charges to lib/payment/ for tenant-to-landlord rent collection; the scope
// cutdown removed that, and rent now arrives as a bank movement rather than a card
// payment. An unrecognised event is acknowledged and dropped rather than treated as a
// failure — Stripe retries a non-2xx, and a subscription account emits plenty of event
// types nobody here subscribed to.
const SUBSCRIPTION_EVENT_TYPES = new Set<string>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/**
 * POST /api/webhooks/stripe - Handle Stripe webhook events
 *
 * Supported events: see SUBSCRIPTION_EVENT_TYPES above.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Respect feature flag: if Stripe is not enabled, return 404 to indicate webhook is disabled
  const stripeKey = getSecret("STRIPE_SECRET_KEY");
  const stripeEnabled = isEnabled("ENABLE_STRIPE") || !!stripeKey;
  if (!stripeEnabled) {
    return NextResponse.json({ error: "Stripe integration disabled" }, { status: 404 });
  }

  // Apply rate limiting for webhooks
  const rateLimitResponse = await rateLimit(request, RateLimits.WEBHOOK);
  if (rateLimitResponse) return rateLimitResponse as NextResponse;

  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      console.warn("[Stripe webhook] Missing signature header");
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    // Verify webhook signature
    const webhookSecret = getSecret("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("[Stripe webhook] STRIPE_WEBHOOK_SECRET not configured");
      return NextResponse.json({ error: "Webhook not configured" }, { status: 404 });
    }

    let event: Stripe.Event;
    try {
      const stripe = getStripeClient();
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Signature verification failed";
      console.error("[Stripe webhook] Signature verification failed:", message);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    console.debug(`[Stripe webhook] Received event: ${event.type}`, { id: event.id });

    if (!SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
      console.debug(`[Stripe webhook] Ignoring unsubscribed event ${event.type}`);
      return NextResponse.json({ received: true, processed: false }, { status: 200 });
    }

    const result = await processSubscriptionWebhook(event);

    if (!result.success) {
      console.error(`[Stripe webhook] Processing failed for ${event.type}:`, result.error);
      // Still return 200 to acknowledge receipt (Stripe will retry otherwise)
      return NextResponse.json(
        {
          received: true,
          processed: false,
          error: result.error,
        },
        { status: 200 },
      );
    }

    console.debug(`[Stripe webhook] Processed ${event.type}`, { id: event.id });

    return NextResponse.json({ received: true, processed: true }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Stripe webhook] Unexpected error:", message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Stripe webhooks should not be rate-limited
// Note: `config` export is deprecated for App Routes; keep handler as-is.
