// Payment Service - Core payment processing for Portugal and Spain
// Supports: Stripe (card, SEPA), Multibanco, MB WAY, Bank Transfer

import Stripe from "stripe";
import { getSecret, isEnabled } from "@/lib/utils/env";
import { getPrismaClient } from "@/lib/services/database/database";
import type {
  PrismaClient,
  PaymentTransaction,
  Tenant,
  TransactionStatus,
  PaymentMethodType,
} from "@prisma/client";
import type { NormalizedProviderEvent } from "./providers/sibs-client";

// Initialize Stripe client lazily to avoid build-time errors
let stripeInstance: Stripe | null = null;

function getStripeInstance(): Stripe {
  if (!stripeInstance) {
    const stripeKey = getSecret("STRIPE_SECRET_KEY");
    const enabled = isEnabled("ENABLE_STRIPE") || !!stripeKey;
    if (!enabled) {
      throw new Error(
        "Stripe is not enabled. Set ENABLE_STRIPE=true or provide STRIPE_SECRET_KEY to enable payments",
      );
    }
    if (!stripeKey) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    stripeInstance = new Stripe(stripeKey, {
      // Not a date literal: stripe-node types this as `LatestApiVersion`, a union of exactly
      // one member — whatever version that SDK release pins. A hardcoded date stops compiling
      // the moment the SDK moves, which is what broke the production-minor Dependabot bump.
      // It was never adding anything either: the SDK resolves `props.apiVersion ||
      // DEFAULT_API_VERSION`, and DEFAULT_API_VERSION *is* this value.
      apiVersion: Stripe.API_VERSION,
    });
  }
  return stripeInstance;
}

export interface CreatePaymentIntentParams {
  amount: number; // Amount in cents
  currency: string;
  tenantId: string;
  invoiceId?: string;
  paymentMethodType: PaymentMethodType;
  description?: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  success: boolean;
  paymentIntentId?: string;
  clientSecret?: string;
  status?: string;
  transactionId?: string;
  error?: string;
  // Multibanco-specific
  multibancoEntity?: string;
  multibancoReference?: string;
  multibancoExpiresAt?: Date;
  // MB WAY-specific
  mbwayRequestId?: string;
}

export interface ProcessWebhookResult {
  success: boolean;
  transactionId?: string;
  newStatus?: TransactionStatus;
  error?: string;
}

export class PaymentService {
  private static instance: PaymentService;
  private isInitialized = false;

  private constructor() {
    this.initialize();
  }

  public static getInstance(): PaymentService {
    if (!PaymentService.instance) {
      PaymentService.instance = new PaymentService();
    }
    return PaymentService.instance;
  }

  private initialize() {
    const stripeKey = getSecret("STRIPE_SECRET_KEY");
    const enabled = isEnabled("ENABLE_STRIPE") || !!stripeKey;
    this.isInitialized = enabled && !!stripeKey;
  }

  public isReady(): boolean {
    return this.isInitialized && !!getSecret("STRIPE_SECRET_KEY");
  }

  /**
   * Get Stripe client for advanced operations
   */
  public getStripeClient(): Stripe {
    return getStripeInstance();
  }

  /**
   * Create a Stripe Customer for a tenant
   */
  public async getOrCreateStripeCustomer(tenantId: string): Promise<string> {
    const prisma: PrismaClient = getPrismaClient();

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { paymentMethods: true },
    });

    if (!tenant) {
      throw new Error("Tenant not found");
    }

    // Check if tenant already has a Stripe customer ID
    const existingMethod = tenant.paymentMethods.find((m) => m.stripeCustomerId);
    if (existingMethod?.stripeCustomerId) {
      return existingMethod.stripeCustomerId;
    }

    // Create new Stripe customer
    const stripe = getStripeInstance();
    const customer = await stripe.customers.create({
      email: tenant.email,
      name: tenant.name,
      phone: tenant.phone,
      metadata: {
        tenantId: tenant.id,
        situsSource: "true",
      },
    });

    return customer.id;
  }

  /**
   * Create a payment intent for various payment methods
   */
  public async createPaymentIntent(
    params: CreatePaymentIntentParams,
  ): Promise<PaymentIntentResult> {
    if (!this.isReady()) {
      return { success: false, error: "Payment service not configured" };
    }

    const prisma: PrismaClient = getPrismaClient();

    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: params.tenantId },
      });

      if (!tenant) {
        return { success: false, error: "Tenant not found" };
      }

      // Get or create Stripe customer
      const customerId = await this.getOrCreateStripeCustomer(params.tenantId);

      // Create payment intent based on method type
      const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
        amount: params.amount,
        currency: params.currency.toLowerCase(),
        customer: customerId,
        description: params.description || `Payment for invoice`,
        metadata: {
          tenantId: params.tenantId,
          invoiceId: params.invoiceId || "",
          ...params.metadata,
        },
      };

      // Configure payment method types based on region and method
      switch (params.paymentMethodType) {
        case "card":
          paymentIntentParams.payment_method_types = ["card"];
          break;
        case "sepa_debit":
          paymentIntentParams.payment_method_types = ["sepa_debit"];
          break;
        case "multibanco":
          paymentIntentParams.payment_method_types = ["multibanco"];
          break;
        case "mbway":
          // MB WAY is not directly supported by Stripe, handled separately
          return this.createMBWayPayment(params, tenant);
        case "bank_transfer":
          paymentIntentParams.payment_method_types = ["customer_balance"];
          paymentIntentParams.payment_method_data = {
            type: "customer_balance",
          };
          paymentIntentParams.payment_method_options = {
            customer_balance: {
              funding_type: "bank_transfer",
              bank_transfer: {
                type: "eu_bank_transfer",
                eu_bank_transfer: {
                  country: "PT",
                },
              },
            },
          };
          break;
        default:
          return {
            success: false,
            error: `Unsupported payment method: ${params.paymentMethodType}`,
          };
      }

      const stripe = getStripeInstance();
      const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

      // Create transaction record
      const transaction = await prisma.paymentTransaction.create({
        data: {
          tenantId: params.tenantId,
          invoiceId: params.invoiceId,
          amount: params.amount,
          currency: params.currency,
          status: "pending",
          provider: "stripe",
          stripePaymentIntentId: paymentIntent.id,
          description: params.description,
          metadata: JSON.stringify(params.metadata || {}),
        },
      });

      const result: PaymentIntentResult = {
        success: true,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret || undefined,
        status: paymentIntent.status,
        transactionId: transaction.id,
      };

      // Extract Multibanco details if available
      if (
        params.paymentMethodType === "multibanco" &&
        paymentIntent.next_action?.multibanco_display_details
      ) {
        const mbDetails = paymentIntent.next_action.multibanco_display_details;
        result.multibancoEntity = mbDetails.entity || undefined;
        result.multibancoReference = mbDetails.reference || undefined;
        result.multibancoExpiresAt = mbDetails.expires_at
          ? new Date(Number(mbDetails.expires_at) * 1000)
          : undefined;

        // Update transaction with Multibanco details
        await prisma.paymentTransaction.update({
          where: { id: transaction.id },
          data: {
            multibancoEntity: result.multibancoEntity,
            multibancoReference: result.multibancoReference,
            multibancoExpiresAt: result.multibancoExpiresAt,
          },
        });
      }

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Payment intent creation failed";
      console.error("Payment intent error:", error);
      return { success: false, error: message };
    }
  }

  /**
   * Create MB WAY payment request (Portugal-specific)
   * Note: MB WAY requires integration with SIBS API (not Stripe)
   * This is a placeholder for future SIBS integration
   */
  private async createMBWayPayment(
    params: CreatePaymentIntentParams,
    _tenant: Tenant,
  ): Promise<PaymentIntentResult> {
    const prisma: PrismaClient = getPrismaClient();

    // MB WAY would require SIBS API integration
    // For now, we create a pending transaction and return instructions

    const transaction = await prisma.paymentTransaction.create({
      data: {
        tenantId: params.tenantId,
        invoiceId: params.invoiceId,
        amount: params.amount,
        currency: params.currency,
        status: "pending",
        provider: "mbway",
        description: params.description,
        metadata: JSON.stringify({
          ...params.metadata,
          note: "MB WAY requires SIBS API integration",
        }),
      },
    });

    return {
      success: true,
      transactionId: transaction.id,
      status: "requires_action",
      error: "MB WAY integration pending - requires SIBS API setup",
    };
  }

  /**
   * Process Stripe webhook events
   */
  public async processStripeWebhook(event: Stripe.Event): Promise<ProcessWebhookResult> {
    const prisma: PrismaClient = getPrismaClient();

    try {
      switch (event.type) {
        case "payment_intent.succeeded": {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          return this.handlePaymentSuccess(paymentIntent, prisma);
        }
        case "payment_intent.payment_failed": {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          return this.handlePaymentFailure(paymentIntent, prisma);
        }
        case "payment_intent.canceled": {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          return this.handlePaymentCanceled(paymentIntent, prisma);
        }
        case "charge.refunded": {
          const charge = event.data.object as Stripe.Charge;
          return this.handleRefund(charge, prisma);
        }
        default:
          return { success: true }; // Ignore unhandled events
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Webhook processing failed";
      console.error("Webhook processing error:", error);
      return { success: false, error: message };
    }
  }

  private async handlePaymentSuccess(
    paymentIntent: Stripe.PaymentIntent,
    prisma: PrismaClient,
  ): Promise<ProcessWebhookResult> {
    const transaction = await prisma.paymentTransaction.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!transaction) {
      return { success: false, error: "Transaction not found" };
    }

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: "succeeded",
        stripeChargeId: paymentIntent.latest_charge as string,
        processedAt: new Date(),
      },
    });

    // Update invoice status if linked
    if (transaction.invoiceId) {
      await prisma.invoice.update({
        where: { id: transaction.invoiceId },
        data: {
          status: "paid",
          paidDate: new Date(),
        },
      });
    }

    return {
      success: true,
      transactionId: transaction.id,
      newStatus: "succeeded",
    };
  }

  private async handlePaymentFailure(
    paymentIntent: Stripe.PaymentIntent,
    prisma: PrismaClient,
  ): Promise<ProcessWebhookResult> {
    const transaction = await prisma.paymentTransaction.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!transaction) {
      return { success: false, error: "Transaction not found" };
    }

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: "failed",
        failedAt: new Date(),
        failureCode: paymentIntent.last_payment_error?.code || undefined,
        failureMessage: paymentIntent.last_payment_error?.message || undefined,
      },
    });

    return {
      success: true,
      transactionId: transaction.id,
      newStatus: "failed",
    };
  }

  private async handlePaymentCanceled(
    paymentIntent: Stripe.PaymentIntent,
    prisma: PrismaClient,
  ): Promise<ProcessWebhookResult> {
    const transaction = await prisma.paymentTransaction.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!transaction) {
      return { success: false, error: "Transaction not found" };
    }

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: "cancelled",
      },
    });

    return {
      success: true,
      transactionId: transaction.id,
      newStatus: "cancelled",
    };
  }

  private async handleRefund(
    charge: Stripe.Charge,
    prisma: PrismaClient,
  ): Promise<ProcessWebhookResult> {
    const transaction = await prisma.paymentTransaction.findFirst({
      where: { stripeChargeId: charge.id },
    });

    if (!transaction) {
      return { success: false, error: "Transaction not found for refund" };
    }

    const refundedAmount =
      typeof charge.amount_refunded === "number"
        ? charge.amount_refunded
        : Number(charge.amount_refunded) || 0;
    const isFullRefund = refundedAmount >= transaction.amount;

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: isFullRefund ? "refunded" : "partially_refunded",
        refundedAmount: refundedAmount,
        refundedAt: new Date(),
      },
    });

    return {
      success: true,
      transactionId: transaction.id,
      newStatus: isFullRefund ? "refunded" : "partially_refunded",
    };
  }

  /**
   * Reconcile a non-Stripe provider event (MB WAY via SIBS, Bizum) against a
   * pending transaction. The transaction is located by the provider's own
   * reference first, then by our merchant transaction id (its primary key).
   */
  public async processProviderWebhook(
    event: NormalizedProviderEvent,
  ): Promise<ProcessWebhookResult> {
    const prisma: PrismaClient = getPrismaClient();

    try {
      const transaction =
        (event.providerTransactionId
          ? await prisma.paymentTransaction.findFirst({
              where: { providerTransactionId: event.providerTransactionId },
            })
          : null) ??
        (event.merchantTransactionId
          ? await prisma.paymentTransaction.findUnique({
              where: { id: event.merchantTransactionId },
            })
          : null);

      if (!transaction) {
        return { success: false, error: "Transaction not found" };
      }

      await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: event.status,
          providerTransactionId: event.providerTransactionId ?? transaction.providerTransactionId,
          ...(event.status === "succeeded" ? { processedAt: new Date() } : {}),
          ...(event.status === "failed" ? { failedAt: new Date() } : {}),
        },
      });

      // Mark the linked invoice paid on success.
      if (event.status === "succeeded" && transaction.invoiceId) {
        await prisma.invoice.update({
          where: { id: transaction.invoiceId },
          data: { status: "paid", paidDate: new Date() },
        });
      }

      return { success: true, transactionId: transaction.id, newStatus: event.status };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Webhook processing failed";
      console.error("Provider webhook processing error:", error);
      return { success: false, error: message };
    }
  }

  /**
   * Get available payment methods for a region
   */
  public getAvailablePaymentMethods(country: string): PaymentMethodType[] {
    switch (country.toUpperCase()) {
      case "PT": // Portugal
        return ["card", "sepa_debit", "multibanco", "mbway", "bank_transfer"];
      case "ES": // Spain
        return ["card", "sepa_debit", "bank_transfer"];
      default: // EU fallback
        return ["card", "sepa_debit", "bank_transfer"];
    }
  }

  /**
   * Get payment method display info
   */
  public getPaymentMethodInfo(type: PaymentMethodType): {
    name: string;
    description: string;
    icon: string;
  } {
    const methods: Record<PaymentMethodType, { name: string; description: string; icon: string }> =
      {
        card: {
          name: "Credit/Debit Card",
          description: "Pay securely with Visa, Mastercard, or American Express",
          icon: "credit-card",
        },
        sepa_debit: {
          name: "SEPA Direct Debit",
          description: "Automatic payments from your European bank account",
          icon: "bank",
        },
        multibanco: {
          name: "Multibanco",
          description: "Pay at any Multibanco ATM or via home banking (Portugal)",
          icon: "building",
        },
        mbway: {
          name: "MB WAY",
          description: "Instant payment via MB WAY app (Portugal)",
          icon: "smartphone",
        },
        bank_transfer: {
          name: "Bank Transfer",
          description: "Manual bank transfer to our account",
          icon: "arrow-right-left",
        },
        cash: {
          name: "Cash",
          description: "Pay in cash (in-person only)",
          icon: "banknote",
        },
        other: {
          name: "Other",
          description: "Alternative payment method",
          icon: "circle-help",
        },
      };

    return methods[type] || methods.other;
  }

  /**
   * List transactions for a tenant
   */
  public async getTenantTransactions(
    tenantId: string,
    options: {
      limit?: number;
      offset?: number;
      status?: TransactionStatus;
    } = {},
  ): Promise<PaymentTransaction[]> {
    const prisma: PrismaClient = getPrismaClient();

    return prisma.paymentTransaction.findMany({
      where: {
        tenantId,
        ...(options.status ? { status: options.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: options.limit || 20,
      skip: options.offset || 0,
    });
  }

  /**
   * Get transaction by ID
   */
  public async getTransaction(transactionId: string): Promise<PaymentTransaction | null> {
    const prisma: PrismaClient = getPrismaClient();
    return prisma.paymentTransaction.findUnique({
      where: { id: transactionId },
    });
  }
}

// Export singleton instance
export const paymentService = PaymentService.getInstance();
