/**
 * The one Stripe client this app constructs, and the API version it speaks.
 *
 * Both halves used to live in `lib/payment/`, alongside the tenant-to-landlord rent
 * collection that the scope cutdown removed. Subscription billing (this directory) was
 * never part of that — it only ever borrowed `paymentService.getStripeClient()`, one
 * method out of a 600-line service — so the factory moved here rather than keeping
 * `lib/payment/` alive for a single call.
 *
 * `STRIPE_API_VERSION` is annotated `Stripe.LatestApiVersion` on purpose: the SDK's types
 * only describe the version it ships with, so a stale string stops compiling instead of
 * silently sending an older payload shape. One line to update per SDK bump, rather than
 * one per `new Stripe(...)`.
 */

import Stripe from "stripe";
import { getSecret, isEnabled } from "@/lib/utils/env";

export const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-08-26.dahlia";

// Constructed lazily: reading the secret at module scope would fail the build on any
// instance that has no Stripe configured, and billing is off by default.
let stripeInstance: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripeInstance) {
    const stripeKey = getSecret("STRIPE_SECRET_KEY");
    const enabled = isEnabled("ENABLE_STRIPE") || !!stripeKey;
    if (!enabled) {
      throw new Error(
        "Stripe is not enabled. Set ENABLE_STRIPE=true or provide STRIPE_SECRET_KEY to enable billing",
      );
    }
    if (!stripeKey) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    stripeInstance = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });
  }
  return stripeInstance;
}

/** Test seam — drops the memoized client so a new secret is picked up. */
export function resetStripeClient(): void {
  stripeInstance = null;
}
