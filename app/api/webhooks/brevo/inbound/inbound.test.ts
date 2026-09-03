import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findFirst: vi.fn() },
    tenant: { findMany: vi.fn() },
    inboundMessage: { findUnique: vi.fn(), create: vi.fn() },
    inboundAttachment: { create: vi.fn(), aggregate: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import type { NextRequest } from "next/server";

import { _resetRateLimitMap } from "@/lib/utils/rate-limit";

import { POST } from "./route";

const SECRET = "s".repeat(64);

function post(body: unknown, auth?: string): NextRequest {
  return new Request("https://example.test/api/webhooks/brevo/inbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth === undefined ? {} : { authorization: auth }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    From: { Name: "Maria", Address: "maria@example.com" },
    To: [{ Address: "rendas@reply.example.com" }],
    Subject: "Fuga de agua",
    RawTextBody: "Ha uma fuga na cozinha.",
    MessageId: "<m1@example.com>",
    Headers: { "Authentication-Results": "mx; spf=pass; dkim=pass" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitMap();
  process.env.BREVO_INBOUND_SECRET = SECRET;
  prismaMock.user.findFirst.mockResolvedValue({ id: "user-1" });
  prismaMock.tenant.findMany.mockResolvedValue([]);
  prismaMock.inboundMessage.findUnique.mockResolvedValue(null);
  prismaMock.inboundMessage.create.mockResolvedValue({ id: "msg-1" });
  prismaMock.notification.create.mockResolvedValue({ id: "n1" });
});

afterEach(() => {
  delete process.env.BREVO_INBOUND_SECRET;
});

/**
 * Brevo signs nothing — not this webhook and not the delivery-event one. The shared secret is
 * the only thing in front of a route that writes message bodies and fetches files onto disk,
 * which makes these the load-bearing tests of the file.
 */
describe("authentication", () => {
  it("refuses a request with no credential", async () => {
    const res = await POST(post({ items: [item()] }));
    expect(res.status).toBe(401);
    expect(prismaMock.inboundMessage.create).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret of the same length", async () => {
    const res = await POST(post({ items: [item()] }, `Bearer ${"x".repeat(64)}`));
    expect(res.status).toBe(401);
    expect(prismaMock.inboundMessage.create).not.toHaveBeenCalled();
  });

  it("refuses a secret that is a prefix of the real one", async () => {
    const res = await POST(post({ items: [item()] }, `Bearer ${"s".repeat(32)}`));
    expect(res.status).toBe(401);
  });

  it("does not accept the delivery-event webhook's secret", async () => {
    // Two routes, two blast radii: leaking the weaker credential must not hand over this one.
    process.env.BREVO_WEBHOOK_SECRET = "e".repeat(64);
    const res = await POST(post({ items: [item()] }, `Bearer ${"e".repeat(64)}`));
    expect(res.status).toBe(401);
    delete process.env.BREVO_WEBHOOK_SECRET;
  });

  it("answers 503 rather than 401 when no secret is configured", async () => {
    delete process.env.BREVO_INBOUND_SECRET;
    const res = await POST(post({ items: [item()] }, `Bearer ${SECRET}`));
    expect(res.status).toBe(503);
  });
});

describe("ingestion", () => {
  it("stores a message with the sender's authentication verdicts", async () => {
    const res = await POST(post({ items: [item()] }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);

    const data = prismaMock.inboundMessage.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "user-1",
      fromAddress: "maria@example.com",
      spfResult: "pass",
      dkimResult: "pass",
    });
  });

  it("suggests a tenant without linking one", async () => {
    // The whole security posture of this feature in one assertion: a From header anyone can
    // forge produces a suggestion, never a filed record.
    prismaMock.tenant.findMany.mockResolvedValue([
      { id: "tenant-1", email: "maria@example.com", propertyId: "prop-1" },
    ]);

    await POST(post({ items: [item()] }, `Bearer ${SECRET}`));

    const data = prismaMock.inboundMessage.create.mock.calls[0][0].data;
    expect(data.suggestedTenantId).toBe("tenant-1");
    expect(data.tenantId).toBeUndefined();
    expect(data.propertyId).toBeUndefined();
  });

  it("treats a redelivery of the same Message-ID as a duplicate", async () => {
    // Brevo retries a batch it thinks failed. A retry must not produce a second copy.
    prismaMock.inboundMessage.findUnique.mockResolvedValue({ id: "existing" });

    const res = await POST(post({ items: [item()] }, `Bearer ${SECRET}`));
    const body = await res.json();

    expect(body).toMatchObject({ stored: 0, duplicates: 1 });
    expect(prismaMock.inboundMessage.create).not.toHaveBeenCalled();
  });

  it("raises a notification so the message is visible without opening the Inbox", async () => {
    await POST(post({ items: [item()] }, `Bearer ${SECRET}`));
    expect(prismaMock.notification.create.mock.calls[0][0].data).toMatchObject({
      type: "inbound_message",
      entityType: "inboundMessage",
      entityId: "msg-1",
    });
  });

  it("discards mail that arrives before any account exists", async () => {
    // Creating an account here would hand instance ownership to whoever sent the email.
    prismaMock.user.findFirst.mockResolvedValue(null);

    const res = await POST(post({ items: [item()] }, `Bearer ${SECRET}`));
    expect(await res.json()).toMatchObject({ stored: 0, skipped: 1 });
    expect(prismaMock.inboundMessage.create).not.toHaveBeenCalled();
  });

  it("survives one failing message without losing the rest of the batch", async () => {
    // A non-2xx makes Brevo redeliver everything, including what already landed.
    prismaMock.inboundMessage.create
      .mockRejectedValueOnce(new Error("constraint"))
      .mockResolvedValue({ id: "msg-2" });

    const res = await POST(
      post(
        { items: [item({ MessageId: "<a@x>" }), item({ MessageId: "<b@x>" })] },
        `Bearer ${SECRET}`,
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stored: 1, skipped: 1 });
  });

  it("caps how many items one delivery may write", async () => {
    const items = Array.from({ length: 60 }, (_, i) => item({ MessageId: `<m${i}@x>` }));
    const res = await POST(post({ items }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(prismaMock.inboundMessage.create).toHaveBeenCalledTimes(25);
  });

  it("drops an item with no sender rather than failing the batch", async () => {
    const res = await POST(
      post({ items: [item({ From: null }), item({ MessageId: "<ok@x>" })] }, `Bearer ${SECRET}`),
    );
    expect(await res.json()).toMatchObject({ received: 1, stored: 1 });
  });

  it("rejects a malformed body", async () => {
    const res = await POST(post("{not json", `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
  });
});
