/**
 * Billing Portal API
 * GET /api/billing/portal
 *
 * Browser-navigable: redirects the signed-in user into a Stripe-hosted
 * Billing Portal session so they can update payment methods, change plans,
 * or cancel their subscription.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { createBillingPortalSession } from "@/lib/billing/subscription-service";

function getBaseUrl(request: NextRequest): string {
  return process.env.NEXTAUTH_URL || request.nextUrl.origin;
}

export async function GET(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const baseUrl = getBaseUrl(request);

  try {
    const url = await createBillingPortalSession(userId, `${baseUrl}/settings?tab=billing`);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("Billing portal error:", error);
    // One condition here is a real, benign answer to the user's request — they have no billing
    // account yet — and flattening it into "Failed to open billing portal" would be a downgrade,
    // not a security win. Everything else reaching this catch is a Stripe internal.
    //
    // Matching the known message and returning a STRING LITERAL is the difference: the text the
    // user sees is authored here, so a new failure mode inside Stripe cannot ride out on it.
    // Same shape as `error.message === "Invoice not found"` in app/api/invoices.
    const noBillingAccount =
      error instanceof Error && error.message === "No billing account found for this user";
    return NextResponse.json(
      {
        error: noBillingAccount
          ? "No billing account found for this user"
          : "Failed to open billing portal",
      },
      { status: 400 },
    );
  }
}
