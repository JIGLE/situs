import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { emailLog: { upsert: vi.fn() } },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import type { NextRequest } from "next/server";

import { POST } from "./route";

const SECRET = "a".repeat(64);

/**
 * Cast once here rather than with a `@ts-expect-error` at every call: those directives attach
 * to the following line, and the formatter is free to move the call onto a different one — at
 * which point the suppression lands on the wrong statement and type-check fails on both the
 * unused directive and the error it was meant to cover.
 */
function post(body: unknown, auth?: string): NextRequest {
  return new Request("https://example.test/api/webhooks/brevo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth === undefined ? {} : { authorization: auth }),
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.emailLog.upsert.mockResolvedValue({ id: "log-1" });
  process.env.BREVO_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.BREVO_WEBHOOK_SECRET;
});

/**
 * Brevo does not sign its webhooks — no HMAC, no signature header — where SendGrid signed every
 * request with ECDSA. The shared secret is therefore the *only* thing in front of this route,
 * which makes these the load-bearing tests of the file.
 */
describe("authentication", () => {
  it("refuses a request with no credential", async () => {
    const res = await POST(post({ event: "delivered" }));
    expect(res.status).toBe(401);
    expect(prismaMock.emailLog.upsert).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret of the same length", async () => {
    // Same length so the length pre-check cannot be what rejects it.
    const res = await POST(post({ event: "delivered" }, `Bearer ${"b".repeat(64)}`));
    expect(res.status).toBe(401);
    expect(prismaMock.emailLog.upsert).not.toHaveBeenCalled();
  });

  it("refuses a secret that is a prefix of the real one", async () => {
    const res = await POST(post({ event: "delivered" }, `Bearer ${"a".repeat(32)}`));
    expect(res.status).toBe(401);
  });

  it("answers 503 rather than 401 when the instance has not configured a secret", async () => {
    delete process.env.BREVO_WEBHOOK_SECRET;
    // Unconfigured is a different condition from unauthorised, and saying so is what stops an
    // operator debugging their Brevo credentials when the problem is their own env file.
    const res = await POST(post({ event: "delivered" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(503);
  });

  it("accepts the bare secret as well as a Bearer prefix", async () => {
    const res = await POST(post({ event: "delivered", "message-id": "m1" }, SECRET));
    expect(res.status).toBe(200);
  });
});

describe("event processing", () => {
  it("maps both bounce kinds to a single bounced status", async () => {
    for (const event of ["hardBounce", "softBounce"]) {
      await POST(post({ event, "message-id": "m1", email: "t@example.com" }, `Bearer ${SECRET}`));
    }
    const statuses = prismaMock.emailLog.upsert.mock.calls.map((c) => c[0].update.status);
    expect(statuses).toEqual(["bounced", "bounced"]);
  });

  it("ignores an event with no message id, since nothing can be correlated to it", async () => {
    const res = await POST(
      post({ event: "delivered", email: "t@example.com" }, `Bearer ${SECRET}`),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.emailLog.upsert).not.toHaveBeenCalled();
  });

  it("records an unrecognised event rather than dropping it", async () => {
    // A vocabulary Brevo adds later should show up as "unknown" in the log, not vanish.
    await POST(post({ event: "somethingNew", "message-id": "m2" }, `Bearer ${SECRET}`));
    expect(prismaMock.emailLog.upsert.mock.calls[0][0].update.status).toBe("unknown");
  });

  it("truncates attacker-controlled strings before they reach the database", async () => {
    await POST(
      post(
        {
          event: "hardBounce",
          "message-id": "m3",
          email: "x".repeat(400),
          reason: "y".repeat(900),
        },
        `Bearer ${SECRET}`,
      ),
    );
    const call = prismaMock.emailLog.upsert.mock.calls[0][0];
    expect(call.create.to.length).toBeLessThanOrEqual(255);
    expect(call.update.failureReason.length).toBeLessThanOrEqual(500);
  });

  it("accepts a batch and caps how many it will write", async () => {
    const batch = Array.from({ length: 150 }, (_, i) => ({
      event: "delivered",
      "message-id": `m${i}`,
    }));
    const res = await POST(post(batch, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(prismaMock.emailLog.upsert).toHaveBeenCalledTimes(100);
  });

  it("survives one failing event without losing the rest of the batch", async () => {
    // A non-2xx would make Brevo retry the whole batch, re-applying the events that did land.
    prismaMock.emailLog.upsert
      .mockRejectedValueOnce(new Error("constraint"))
      .mockResolvedValue({ id: "log-2" });

    const res = await POST(
      post(
        [
          { event: "delivered", "message-id": "m1" },
          { event: "delivered", "message-id": "m2" },
        ],
        `Bearer ${SECRET}`,
      ),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.emailLog.upsert).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed body", async () => {
    const bad = new Request("https://example.test/api/webhooks/brevo", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: "{not json",
    }) as unknown as NextRequest;
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });
});
