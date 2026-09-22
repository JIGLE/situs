// SaaS subscription billing for the app itself — Stripe Checkout + Billing
// Portal + webhook sync, backing the Free/Pro/Business tiers on the landing
// page (previously unbacked marketing copy, see docs/PRODUCT_AUDIT_2026.md §2).
// Distinct from rent collection, which arrives as a bank movement, not a card payment.

import type Stripe from "stripe";
import { getSecret, isEnabled } from "@/lib/utils/env";
import { getPrismaClient } from "@/lib/services/database/database";
import type { PrismaClient, Subscription } from "@prisma/client";
import { getStripeClient } from "./stripe-client";
import { getPlanLimits, type PlanId } from "./plan-limits";

const PAID_PLAN_PRICE_ENV: Record<"pro" | "business", string> = {
  pro: "STRIPE_PRICE_ID_PRO",
  business: "STRIPE_PRICE_ID_BUSINESS",
};

async function getOrCreateSubscriptionRow(
  prisma: PrismaClient,
  userId: string,
): Promise<Subscription> {
  const existing = await prisma.subscription.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.subscription.create({ data: { userId } });
}

/** Get (or lazily create) the Stripe Customer for the app's own billing, scoped to a User. */
export async function getOrCreateStripeCustomerForUser(userId: string): Promise<string> {
  const prisma = getPrismaClient();
  const subscription = await getOrCreateSubscriptionRow(prisma, userId);
  if (subscription.stripeCustomerId) return subscription.stripeCustomerId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user) throw new Error("User not found");

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId, situsSource: "true" },
  });

  await prisma.subscription.update({
    where: { userId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

/**
 * Create a Stripe Checkout Session for a paid plan upgrade. Offers card and
 * SEPA Direct Debit (the EU market's preferred bank-debit method) and turns
 * on Stripe Tax so VAT is calculated per customer country.
 */
export async function createCheckoutSession(
  userId: string,
  plan: "pro" | "business",
  urls: { successUrl: string; cancelUrl: string },
  options: { trialDays?: number } = {},
): Promise<string> {
  const priceId = getSecret(PAID_PLAN_PRICE_ENV[plan]);
  if (!priceId) {
    throw new Error(`${PAID_PLAN_PRICE_ENV[plan]} is not configured`);
  }

  const customerId = await getOrCreateStripeCustomerForUser(userId);
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    payment_method_types: ["card", "sepa_debit"],
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    automatic_tax: { enabled: true },
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    metadata: { userId, plan },
    subscription_data: {
      metadata: { userId, plan },
      ...(options.trialDays ? { trial_period_days: options.trialDays } : {}),
    },
  });

  if (!session.url) throw new Error("Stripe did not return a Checkout URL");
  return session.url;
}

/** Create a Stripe Billing Portal session so a user can manage/cancel their subscription. */
export async function createBillingPortalSession(
  userId: string,
  returnUrl: string,
): Promise<string> {
  const prisma = getPrismaClient();
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription?.stripeCustomerId) {
    throw new Error("No billing account found for this user");
  }

  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}

export interface CurrentPlanInfo {
  plan: PlanId;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  maxProperties: number | null;
  propertyCount: number;
}

/** The signed-in user's plan, status, and property usage vs. their plan's limit. */
export async function getCurrentPlanInfo(
  prisma: PrismaClient,
  userId: string,
): Promise<CurrentPlanInfo> {
  const [subscription, propertyCount] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId } }),
    prisma.property.count({ where: { userId } }),
  ]);

  const plan = (subscription?.plan ?? "free") as PlanId;

  return {
    plan,
    status: subscription?.status ?? "active",
    currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    maxProperties: getPlanLimits(plan).maxProperties,
    propertyCount,
  };
}

/**
 * Whether this user may create one more property under their plan. Always
 * true unless ENABLE_BILLING=true — self-hosted instances are never limited
 * by default (see docs/PRODUCT_AUDIT_2026.md §2 and the landing page's own
 * "self-hosted is always free" disclaimer).
 */
export async function canCreateProperty(prisma: PrismaClient, userId: string): Promise<boolean> {
  if (!isEnabled("ENABLE_BILLING")) return true;

  const { maxProperties, propertyCount } = await getCurrentPlanInfo(prisma, userId);
  if (maxProperties === null) return true;
  return propertyCount < maxProperties;
}

function resolvePlanFromPriceId(priceId: string | undefined): PlanId {
  if (priceId && priceId === getSecret(PAID_PLAN_PRICE_ENV.pro)) return "pro";
  if (priceId && priceId === getSecret(PAID_PLAN_PRICE_ENV.business)) return "business";
  return "free";
}

function mapStripeStatus(status: Stripe.Subscription.Status): Subscription["status"] {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return "canceled";
    default:
      return "incomplete";
  }
}

async function syncSubscriptionFromStripe(
  prisma: PrismaClient,
  userId: string,
  sub: Stripe.Subscription,
): Promise<void> {
  // As of Stripe's 2025 "basil" API, billing-period fields live on the
  // subscription item, not the subscription itself.
  const item = sub.items.data[0];
  const priceId = item?.price?.id;
  const status = mapStripeStatus(sub.status);
  const plan = status === "canceled" ? "free" : resolvePlanFromPriceId(priceId);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  const data = {
    plan,
    status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId ?? null,
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };

  await prisma.subscription.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}

export interface SubscriptionWebhookResult {
  success: boolean;
  error?: string;
}

/** Handle the subscription-lifecycle Stripe events (checkout.session.completed, customer.subscription.*). */
export async function processSubscriptionWebhook(
  event: Stripe.Event,
): Promise<SubscriptionWebhookResult> {
  const prisma = getPrismaClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription" || !session.subscription) {
          return { success: true };
        }
        const userId = session.metadata?.userId;
        if (!userId) return { success: false, error: "Missing userId in session metadata" };

        const stripe = getStripeClient();
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
        await syncSubscriptionFromStripe(prisma, userId, stripeSubscription);
        return { success: true };
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const stripeSubscription = event.data.object as Stripe.Subscription;
        const userId = stripeSubscription.metadata?.userId;
        if (userId) {
          await syncSubscriptionFromStripe(prisma, userId, stripeSubscription);
          return { success: true };
        }

        // Fall back to matching by Stripe customer id (e.g. events fired
        // without our metadata, such as Portal-initiated changes).
        const customerId =
          typeof stripeSubscription.customer === "string"
            ? stripeSubscription.customer
            : stripeSubscription.customer.id;
        const existing = await prisma.subscription.findFirst({
          where: { stripeCustomerId: customerId },
        });
        if (!existing) return { success: false, error: "Subscription not found for customer" };
        await syncSubscriptionFromStripe(prisma, existing.userId, stripeSubscription);
        return { success: true };
      }
      default:
        return { success: true };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Subscription webhook processing failed";
    console.error("Subscription webhook error:", error);
    return { success: false, error: message };
  }
}
