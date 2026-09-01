// The Stripe API version every client in this app is constructed with.
//
// Lives in one place because it is a claim the SDK can falsify: `stripe`'s types
// only describe the version it ships with, so a minor bump moves the literal type
// and a stale string stops compiling. Annotating it `Stripe.LatestApiVersion`
// keeps that check — a wrong value fails `type-check` rather than silently sending
// an older payload shape — while leaving exactly one line to update per bump
// instead of one per `new Stripe(...)` call site.
import type Stripe from "stripe";

export const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-08-26.dahlia";
