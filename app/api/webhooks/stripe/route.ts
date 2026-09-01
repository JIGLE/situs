// Stripe Webhook Handler - Process payment and subscription-billing events
import { NextRequest, NextResponse } from "next/server";
import { paymentService } from "@/lib/payment/payment-service";
import { processSubscriptionWebhook } from "@/lib/billing/subscription-service";
import { getSecret, isEnabled } from "@/lib/utils/env";
import { rateLimit, RateLimits } from "@/lib/middleware/rate-limit";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "@/lib/payment/stripe-api-version";

// Event types owned by the app's own subscription billing (lib/billing/), as
// opposed to tenant-to-landlord rent collection (lib/payment/).
const SUBSCRIPTION_EVENT_TYPES = new Set<string>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

// Lazy initialization of Stripe
function getStripe(): Stripe {
  const key = getSecret("STRIPE_SECRET_KEY");
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
  });
}

/**
 * POST /api/webhooks/stripe - Handle Stripe webhook events
 *
 * Supported events:
 * - payment_intent.succeeded
 * - payment_intent.payment_failed
 * - payment_intent.canceled
 * - charge.refunded
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
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Signature verification failed";
      console.error("[Stripe webhook] Signature verification failed:", message);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    console.debug(`[Stripe webhook] Received event: ${event.type}`, { id: event.id });

    // Process the event — subscription-billing events go to lib/billing/,
    // everything else (payment intents, charges) stays with lib/payment/.
    const result = SUBSCRIPTION_EVENT_TYPES.has(event.type)
      ? await processSubscriptionWebhook(event)
      : await paymentService.processStripeWebhook(event);

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

    console.debug(`[Stripe webhook] Processed ${event.type}`, {
      transactionId: result.transactionId,
      newStatus: result.newStatus,
    });

    return NextResponse.json(
      {
        received: true,
        processed: true,
        transactionId: result.transactionId,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Stripe webhook] Unexpected error:", message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Stripe webhooks should not be rate-limited
// Note: `config` export is deprecated for App Routes; keep handler as-is.
