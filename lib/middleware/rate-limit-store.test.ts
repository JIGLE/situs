// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRateLimitStore, RedisRateLimitStore } from "./rate-limit-store";

/**
 * The limiter counts a request in ONE step (`hit`), because counting in two (read, add one, write)
 * loses updates as soon as the count lives in another process: a burst of parallel requests all read
 * the same number and all pass. What is proved here is the burst, on the memory store and on a real
 * Redis; what happens when Redis is down; and that the window still ends.
 */

describe("MemoryRateLimitStore", () => {
  let store: MemoryRateLimitStore;
  beforeEach(() => {
    store = new MemoryRateLimitStore();
  });
  afterEach(() => {
    store.destroy();
    vi.useRealTimers();
  });

  it("counts each hit in a window, from one", async () => {
    const counts = [];
    for (let i = 0; i < 4; i++) counts.push((await store.hit("k", 60_000)).count);

    expect(counts).toEqual([1, 2, 3, 4]);
  });

  it("gives a parallel burst every number exactly once: none is lost", async () => {
    const hits = await Promise.all(Array.from({ length: 200 }, () => store.hit("k", 60_000)));

    expect(hits.map((h) => h.count).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 200 }, (_, i) => i + 1),
    );
  });

  it("keeps the window's end fixed by its first hit", async () => {
    const first = await store.hit("k", 60_000);
    const second = await store.hit("k", 60_000);

    expect(second.resetTime).toBe(first.resetTime);
  });

  it("opens a new window once the old one has ended", async () => {
    vi.useFakeTimers();
    await store.hit("k", 1_000);
    await store.hit("k", 1_000);
    vi.advanceTimersByTime(1_500);

    expect((await store.hit("k", 1_000)).count).toBe(1);
  });

  it("keeps keys apart", async () => {
    await store.hit("a", 60_000);
    await store.hit("a", 60_000);

    expect((await store.hit("b", 60_000)).count).toBe(1);
  });

  it("reads a window without counting a request, and hands out copies", async () => {
    await store.hit("k", 60_000);
    const read = await store.get("k");
    read!.count = 999;

    expect((await store.get("k"))?.count).toBe(1);
    expect(await store.get("nobody")).toBeNull();
  });

  it("forgets a key that is deleted", async () => {
    await store.hit("k", 60_000);
    await store.delete("k");

    expect((await store.hit("k", 60_000)).count).toBe(1);
  });
});

describe("RedisRateLimitStore when Redis cannot be used", () => {
  afterEach(() => vi.resetModules());

  it("counts in this process instead of letting everything through", async () => {
    // No REDIS_URL and no reachable server: the store must still limit.
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1");
    const store = new RedisRateLimitStore();

    const counts = [];
    await store.hit("k", 60_000); // the one request that waits for the connection
    const started = Date.now();
    for (let i = 0; i < 3; i++) counts.push((await store.hit("k", 60_000)).count);
    const waited = Date.now() - started;
    vi.unstubAllEnvs();

    expect(counts).toEqual([2, 3, 4]);
    // The later ones do not each wait for a connection that is not coming.
    expect(waited).toBeLessThan(500);
  });
});

/**
 * Against a real Redis (the Lua script is only proved by running it). Starts its own server on a free
 * port when `redis-server` is installed; where it is not, these are skipped and the memory store's
 * tests above are the whole proof.
 */
const REDIS_BIN = ["/usr/bin/redis-server", "/usr/local/bin/redis-server"].find((p) =>
  existsSync(p),
);

describe.skipIf(!REDIS_BIN)("RedisRateLimitStore against a real Redis", () => {
  let server: ChildProcess;
  let url: string;
  let port: number;
  const stores: RedisRateLimitStore[] = [];
  const make = () => {
    const store = new RedisRateLimitStore(url);
    stores.push(store);
    return store;
  };

  async function freePort(): Promise<number> {
    return new Promise((resolve) => {
      const probe = net.createServer().listen(0, "127.0.0.1", () => {
        const { port: p } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(p));
      });
    });
  }

  async function waitForRedis(p: number): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const up = await new Promise<boolean>((resolve) => {
        const socket = net.connect(p, "127.0.0.1", () => {
          socket.destroy();
          resolve(true);
        });
        socket.on("error", () => resolve(false));
      });
      if (up) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("redis-server did not start");
  }

  beforeAll(async () => {
    port = await freePort();
    url = `redis://127.0.0.1:${port}`;
    server = spawn(REDIS_BIN!, ["--port", String(port), "--save", "", "--appendonly", "no"], {
      stdio: "ignore",
    });
    await waitForRedis(port);
  }, 20_000);

  afterAll(async () => {
    await Promise.all(stores.map((s) => s.disconnect().catch(() => undefined)));
    server?.kill();
  });

  it("gives a parallel burst across two separate processes every number exactly once", async () => {
    const a = make();
    const b = make();

    const hits = await Promise.all(
      Array.from({ length: 300 }, (_, i) => (i % 2 ? a : b).hit("burst", 60_000)),
    );

    expect(hits.map((h) => h.count).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 300 }, (_, i) => i + 1),
    );
  });

  it("ends the window: the key expires and the count starts again", async () => {
    const store = make();
    await store.hit("short", 300);
    await store.hit("short", 300);
    await new Promise((r) => setTimeout(r, 450));

    expect((await store.hit("short", 300)).count).toBe(1);
  });

  it("reports the time left in the window, not a guess", async () => {
    const store = make();
    const first = await store.hit("ttl", 5_000);
    const second = await store.hit("ttl", 5_000);

    expect(second.count).toBe(2);
    expect(second.resetTime).toBeGreaterThan(Date.now());
    expect(second.resetTime).toBeLessThanOrEqual(first.resetTime + 50);
    expect(second.resetTime).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("gives a counter that somehow has no expiry one, so it cannot count for ever", async () => {
    const store = make();
    const { createClient } = await import("redis");
    const raw = createClient({ url });
    await raw.connect();
    await raw.set("ratelimit:hit:immortal", "7");
    expect(await raw.pTTL("ratelimit:hit:immortal")).toBe(-1);

    const entry = await store.hit("immortal", 5_000);

    expect(entry.count).toBe(8);
    expect(await raw.pTTL("ratelimit:hit:immortal")).toBeGreaterThan(0);
    await raw.quit();
  });

  it("reads a window without counting, and deletes it", async () => {
    const store = make();
    await store.hit("peek", 60_000);
    await store.hit("peek", 60_000);

    expect((await store.get("peek"))?.count).toBe(2);
    expect((await store.get("peek"))?.count).toBe(2);
    await store.delete("peek");
    expect(await store.get("peek")).toBeNull();
  });

  it("keeps counting in this process when the server goes away", async () => {
    const store = make();
    await store.hit("outage", 60_000);
    server.kill();
    await new Promise((r) => setTimeout(r, 200));

    const counts = [];
    for (let i = 0; i < 3; i++) counts.push((await store.hit("outage-after", 60_000)).count);

    expect(counts).toEqual([1, 2, 3]);
  });
});
