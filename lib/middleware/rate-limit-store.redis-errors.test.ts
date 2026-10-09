// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the Redis store does when a command fails while it IS connected: the request is counted in
 * this process, and the caller never sees the error. (The real-Redis tests in
 * rate-limit-store.test.ts cover the server going away; this covers the connection that is up and
 * the command that is not.)
 */

const fake = vi.hoisted(() => {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    listeners,
    eval: vi.fn(),
    get: vi.fn(),
    pTTL: vi.fn(),
    del: vi.fn(),
    quit: vi.fn(),
  };
});

vi.mock("redis", () => ({
  createClient: () => ({
    on: (event: string, listener: (...args: unknown[]) => void) => {
      (fake.listeners[event] ??= []).push(listener);
    },
    connect: async () => {
      for (const listener of fake.listeners.connect ?? []) listener();
    },
    eval: fake.eval,
    get: fake.get,
    pTTL: fake.pTTL,
    del: fake.del,
    quit: fake.quit,
  }),
}));

import { RedisRateLimitStore } from "./rate-limit-store";

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(fake.listeners)) delete fake.listeners[key];
});

describe("RedisRateLimitStore with a connected client", () => {
  it("sends one script that counts and expires, for a key of its own", async () => {
    fake.eval.mockResolvedValue([3, 41_000]);
    const store = new RedisRateLimitStore("redis://x");

    const entry = await store.hit("client:/api/x", 60_000);

    expect(entry.count).toBe(3);
    expect(entry.resetTime).toBeGreaterThan(Date.now() + 40_000);
    const [script, options] = fake.eval.mock.calls[0];
    expect(script).toMatch(/INCR/);
    expect(script).toMatch(/PEXPIRE/);
    expect(options).toEqual({ keys: ["ratelimit:hit:client:/api/x"], arguments: ["60000"] });
  });

  it("counts in this process when the command fails, and does not throw", async () => {
    fake.eval.mockRejectedValue(new Error("READONLY You can't write against a read only replica"));
    const store = new RedisRateLimitStore("redis://x");

    const counts = [];
    for (let i = 0; i < 3; i++) counts.push((await store.hit("k", 60_000)).count);

    expect(counts).toEqual([1, 2, 3]);
  });

  it("counts in this process when the reply is not a count and a time", async () => {
    fake.eval.mockResolvedValue("OK");
    const store = new RedisRateLimitStore("redis://x");

    expect((await store.hit("k", 60_000)).count).toBe(1);
    expect((await store.hit("k", 60_000)).count).toBe(2);
  });

  it("reads a window as a count and the time left, and nothing for a key that is gone", async () => {
    fake.get.mockResolvedValueOnce("4");
    fake.pTTL.mockResolvedValueOnce(30_000);
    const store = new RedisRateLimitStore("redis://x");

    expect((await store.get("k"))?.count).toBe(4);

    fake.get.mockResolvedValueOnce(null);
    fake.pTTL.mockResolvedValueOnce(-2);
    expect(await store.get("k")).toBeNull();
  });
});
