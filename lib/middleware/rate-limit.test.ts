// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The limiter in front of the routes: a burst of parallel requests from one client is let through
 * only up to the limit, however they interleave.
 */

const { storeRef } = vi.hoisted(() => ({
  storeRef: { current: null as import("./rate-limit-store").RateLimitStore | null },
}));
vi.mock("./rate-limit-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("./rate-limit-store")>();
  return { ...original, getRateLimitStore: () => storeRef.current! };
});

import { MemoryRateLimitStore } from "./rate-limit-store";
import { getRateLimitStatus, rateLimit } from "./rate-limit";

const request = (path = "/api/thing") =>
  new Request(`https://example.test${path}`, { headers: { "x-forwarded-for": "203.0.113.9" } });
const config = { maxRequests: 5, windowSeconds: 60, identifier: () => "client" };

beforeEach(() => {
  delete process.env.E2E_DISABLE_RATE_LIMIT;
  storeRef.current = new MemoryRateLimitStore();
});

describe("rateLimit", () => {
  it("lets exactly the limit through from a parallel burst and refuses the rest", async () => {
    const results = await Promise.all(
      Array.from({ length: 60 }, () => rateLimit(request(), config)),
    );

    expect(results.filter((r) => r === null)).toHaveLength(5);
    expect(results.filter((r) => r?.status === 429)).toHaveLength(55);
  });

  it("says when to come back, at least a second", async () => {
    for (let i = 0; i < 5; i++) await rateLimit(request(), config);

    const refused = await rateLimit(request(), config);

    expect(refused?.status).toBe(429);
    expect(Number(refused?.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(await refused?.json()).toMatchObject({ error: "Rate limit exceeded" });
  });

  it("keeps one path's budget apart from another's", async () => {
    for (let i = 0; i < 5; i++) await rateLimit(request("/a"), config);

    expect(await rateLimit(request("/a"), config)).not.toBeNull();
    expect(await rateLimit(request("/b"), config)).toBeNull();
  });
});

describe("getRateLimitStatus", () => {
  it("reads the window a scope names, without counting a request", async () => {
    const scoped = { ...config, scope: "shared" };
    await rateLimit(request("/one"), scoped);
    await rateLimit(request("/two"), scoped);

    const status = await getRateLimitStatus(request("/three"), scoped);
    const again = await getRateLimitStatus(request("/three"), scoped);

    expect(status.remaining).toBe(3);
    expect(again.remaining).toBe(3);
  });
});
