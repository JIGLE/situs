import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSecretMock, isEnabledMock } = vi.hoisted(() => ({
  getSecretMock: vi.fn(),
  isEnabledMock: vi.fn(),
}));

vi.mock("@/lib/utils/env", () => ({
  getSecret: getSecretMock,
  isEnabled: isEnabledMock,
}));

const { stripeClientMock } = vi.hoisted(() => ({
  stripeClientMock: {
    customers: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
    subscriptions: { retrieve: vi.fn() },
  },
}));

vi.mock("./stripe-client", () => ({
  getStripeClient: () => stripeClientMock,
}));

const mockPrismaClient = {
  subscription: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  user: { findUnique: vi.fn() },
  property: { count: vi.fn() },
};

vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => mockPrismaClient,
}));

import {
  getOrCreateStripeCustomerForUser,
  createCheckoutSession,
  createBillingPortalSession,
  getCurrentPlanInfo,
  canCreateProperty,
  processSubscriptionWebhook,
} from "./subscription-service";

function envDefaults() {
  getSecretMock.mockImplementation((key: string) => {
    if (key === "STRIPE_PRICE_ID_PRO") return "price_pro_123";
    if (key === "STRIPE_PRICE_ID_BUSINESS") return "price_business_456";
    return undefined;
  });
  isEnabledMock.mockReturnValue(false);
}

describe("getOrCreateStripeCustomerForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envDefaults();
  });

  it("creates a Subscription row and a Stripe customer when none exists", async () => {
    mockPrismaClient.subscription.findUnique.mockResolvedValue(null);
    mockPrismaClient.subscription.create.mockResolvedValue({
      userId: "user-1",
      stripeCustomerId: null,
    });
    mockPrismaClient.user.findUnique.mockResolvedValue({
      email: "a@example.com",
      name: "Ana",
    });
    stripeClientMock.customers.create.mockResolvedValue({ id: "cus_new" });

    const customerId = await getOrCreateStripeCustomerForUser("user-1");

    expect(customerId).toBe("cus_new");
    expect(mockPrismaClient.subscription.create).toHaveBeenCalledWith({
      data: { userId: "user-1" },
    });
    expect(stripeClientMock.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@example.com", name: "Ana" }),
    );
    expect(mockPrismaClient.subscription.update).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { stripeCustomerId: "cus_new" },
    });
  });

  it("returns the existing Stripe customer id without creating a new one", async () => {
    mockPrismaClient.subscription.findUnique.mockResolvedValue({
      userId: "user-1",
      stripeCustomerId: "cus_existing",
    });

    const customerId = await getOrCreateStripeCustomerForUser("user-1");

    expect(customerId).toBe("cus_existing");
    expect(stripeClientMock.customers.create).not.toHaveBeenCalled();
  });
});

describe("createCheckoutSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envDefaults();
    mockPrismaClient.subscription.findUnique.mockResolvedValue({
      userId: "user-1",
      stripeCustomerId: "cus_existing",
    });
  });

  it("throws when the plan's price id isn't configured", async () => {
    getSecretMock.mockReturnValue(undefined);

    await expect(
      createCheckoutSession("user-1", "pro", {
        successUrl: "https://app/success",
        cancelUrl: "https://app/cancel",
      }),
    ).rejects.toThrow("STRIPE_PRICE_ID_PRO is not configured");
  });

  it("creates a subscription Checkout Session with card + SEPA and automatic tax", async () => {
    stripeClientMock.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/session/abc",
    });

    const url = await createCheckoutSession("user-1", "pro", {
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    });

    expect(url).toBe("https://checkout.stripe.com/session/abc");
    expect(stripeClientMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_existing",
        line_items: [{ price: "price_pro_123", quantity: 1 }],
        payment_method_types: ["card", "sepa_debit"],
        automatic_tax: { enabled: true },
        metadata: { userId: "user-1", plan: "pro" },
      }),
    );
  });

  it("throws if Stripe does not return a Checkout URL", async () => {
    stripeClientMock.checkout.sessions.create.mockResolvedValue({ url: null });

    await expect(
      createCheckoutSession("user-1", "business", {
        successUrl: "https://app/success",
        cancelUrl: "https://app/cancel",
      }),
    ).rejects.toThrow("Stripe did not return a Checkout URL");
  });
});

describe("createBillingPortalSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envDefaults();
  });

  it("throws when the user has no Stripe customer yet", async () => {
    mockPrismaClient.subscription.findUnique.mockResolvedValue(null);

    await expect(createBillingPortalSession("user-1", "https://app/return")).rejects.toThrow(
      "No billing account found for this user",
    );
  });

  it("returns the Billing Portal URL", async () => {
    mockPrismaClient.subscription.findUnique.mockResolvedValue({
      stripeCustomerId: "cus_existing",
    });
    stripeClientMock.billingPortal.sessions.create.mockResolvedValue({
      url: "https://billing.stripe.com/session/xyz",
    });

    const url = await createBillingPortalSession("user-1", "https://app/return");

    expect(url).toBe("https://billing.stripe.com/session/xyz");
    expect(stripeClientMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_existing",
      return_url: "https://app/return",
    });
  });
});

describe("getCurrentPlanInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envDefaults();
  });

  it("defaults to Free with no usage when the user has no Subscription row", async () => {
    mockPrismaClient.subscription.findUnique.mockResolvedValue(null);
    mockPrismaClient.property.count.mockResolvedValue(0);

    const info = await getCurrentPlanInfo(mockPrismaClient as never, "user-1");

    expect(info).toEqual({
      plan: "free",
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      maxProperties: 1,
      propertyCount: 0,
    });
  });

  it("reports a paid plan's usage against its limit", async () => {
    mockPrismaClient.subscription.findUnique.mockResolvedValue({
      plan: "pro",
      status: "active",
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      cancelAtPeriodEnd: true,
    });
    mockPrismaClient.property.count.mockResolvedValue(4);

    const info = await getCurrentPlanInfo(mockPrismaClient as never, "user-1");

    expect(info.plan).toBe("pro");
    expect(info.maxProperties).toBe(10);
    expect(info.propertyCount).toBe(4);
    expect(info.cancelAtPeriodEnd).toBe(true);
    expect(info.currentPeriodEnd).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("canCreateProperty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envDefaults();
  });

  it("is always true when billing enforcement is disabled", async () => {
    isEnabledMock.mockReturnValue(false);
    mockPrismaClient.subscription.findUnique.mockResolvedValue({ plan: "free" });
    mockPrismaClient.property.count.mockResolvedValue(50);

    expect(await canCreateProperty(mockPrismaClient as never, "user-1")).toBe(true);
  });

  it("blocks a Free-plan user who already has 1 property when billing is enforced", async () => {
    isEnabledMock.mockReturnValue(true);
    mockPrismaClient.subscription.findUnique.mockResolvedValue(null);
    mockPrismaClient.property.count.mockResolvedValue(1);

    expect(await canCreateProperty(mockPrismaClient as never, "user-1")).toBe(false);
  });

  it("never blocks the unlimited Business plan", async () => {
    isEnabledMock.mockReturnValue(true);
    mockPrismaClient.subscription.findUnique.mockResolvedValue({ plan: "business" });
    mockPrismaClient.property.count.mockResolvedValue(500);

    expect(await canCreateProperty(mockPrismaClient as never, "user-1")).toBe(true);
  });
});

describe("processSubscriptionWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envDefaults();
  });

  it("syncs a subscription after checkout.session.completed", async () => {
    stripeClientMock.subscriptions.retrieve.mockResolvedValue({
      id: "sub_123",
      status: "active",
      customer: "cus_existing",
      cancel_at_period_end: false,
      current_period_end: 1_800_000_000,
      items: { data: [{ price: { id: "price_pro_123" } }] },
    });

    const result = await processSubscriptionWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub_123",
          metadata: { userId: "user-1" },
        },
      },
    } as never);

    expect(result).toEqual({ success: true });
    expect(mockPrismaClient.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        update: expect.objectContaining({ plan: "pro", status: "active" }),
      }),
    );
  });

  it("ignores non-subscription-mode checkout sessions", async () => {
    const result = await processSubscriptionWebhook({
      type: "checkout.session.completed",
      data: { object: { mode: "payment" } },
    } as never);

    expect(result).toEqual({ success: true });
    expect(mockPrismaClient.subscription.upsert).not.toHaveBeenCalled();
  });

  it("downgrades to free on customer.subscription.deleted", async () => {
    const result = await processSubscriptionWebhook({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_123",
          status: "canceled",
          customer: "cus_existing",
          cancel_at_period_end: false,
          current_period_end: 1_800_000_000,
          metadata: { userId: "user-1" },
          items: { data: [{ price: { id: "price_pro_123" } }] },
        },
      },
    } as never);

    expect(result).toEqual({ success: true });
    expect(mockPrismaClient.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ plan: "free", status: "canceled" }),
      }),
    );
  });

  it("falls back to matching by Stripe customer id when metadata is missing", async () => {
    mockPrismaClient.subscription.findFirst.mockResolvedValue({ userId: "user-2" });

    const result = await processSubscriptionWebhook({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_456",
          status: "active",
          customer: "cus_no_metadata",
          cancel_at_period_end: false,
          current_period_end: 1_800_000_000,
          metadata: {},
          items: { data: [{ price: { id: "price_business_456" } }] },
        },
      },
    } as never);

    expect(result).toEqual({ success: true });
    expect(mockPrismaClient.subscription.findFirst).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_no_metadata" },
    });
    expect(mockPrismaClient.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-2" } }),
    );
  });

  it("no-ops on unrelated event types", async () => {
    const result = await processSubscriptionWebhook({ type: "invoice.paid", data: {} } as never);
    expect(result).toEqual({ success: true });
    expect(mockPrismaClient.subscription.upsert).not.toHaveBeenCalled();
  });
});
