/**
 * Billing Checkout API
 * GET /api/billing/checkout?plan=pro|business
 *
 * Browser-navigable (used both as a landing-page CTA href and a Settings
 * "Upgrade" button target): redirects an unauthenticated visitor to sign-in
 * with a callback back to this same URL, then redirects an authenticated
 * one straight into a Stripe Checkout Session for the requested plan.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { createCheckoutSession } from "@/lib/billing/subscription-service";
import { getSecret } from "@/lib/utils/env";

const UPGRADABLE_PLANS = new Set(["pro", "business"]);

// Pro's landing-page copy promises a free trial; Business's doesn't. Operators
// can override the length, or unset STRIPE_TRIAL_DAYS_PRO=0 to disable it.
const DEFAULT_PRO_TRIAL_DAYS = 14;

function getProTrialDays(): number | undefined {
  const raw = getSecret("STRIPE_TRIAL_DAYS_PRO");
  const days = raw === undefined ? DEFAULT_PRO_TRIAL_DAYS : Number(raw);
  return Number.isFinite(days) && days > 0 ? days : undefined;
}

function getBaseUrl(request: NextRequest): string {
  return process.env.NEXTAUTH_URL || request.nextUrl.origin;
}

export async function GET(request: NextRequest): Promise<Response> {
  const plan = request.nextUrl.searchParams.get("plan");
  if (!plan || !UPGRADABLE_PLANS.has(plan)) {
    return NextResponse.json(
      { error: "A valid plan (pro or business) is required" },
      { status: 400 },
    );
  }

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) {
    const callbackUrl = encodeURIComponent(`${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(
      new URL(`/auth/signin?callbackUrl=${callbackUrl}`, getBaseUrl(request)),
    );
  }

  const { userId } = authResult;
  const baseUrl = getBaseUrl(request);

  try {
    const url = await createCheckoutSession(
      userId,
      plan as "pro" | "business",
      {
        successUrl: `${baseUrl}/settings?tab=billing&checkout=success`,
        cancelUrl: `${baseUrl}/settings?tab=billing&checkout=canceled`,
      },
      { trialDays: plan === "pro" ? getProTrialDays() : undefined },
    );
    return NextResponse.redirect(url);
  } catch (error) {
    // Stripe errors carry request ids, key prefixes and account detail. Logged, not returned.
    console.error("Billing checkout error:", error);
    return NextResponse.json({ error: "Failed to start checkout" }, { status: 500 });
  }
}
