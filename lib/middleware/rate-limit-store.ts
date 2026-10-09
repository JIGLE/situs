/**
 * Redis Rate Limiting Store
 *
 * Production-grade distributed rate limiting using Redis.
 * Supports horizontal scaling with consistent rate limits across instances.
 */

import { logger } from "@/lib/utils/logger";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Abstract rate limit store interface.
 *
 * `hit` is the one write: it counts a request and says where the window stands, as ONE atomic
 * step. The limiter used to read the entry, add one in its own memory and write it back, which is
 * exact in one process but loses updates the moment the entry lives somewhere else (Redis): a burst
 * of parallel requests all read the same count, all add one to it, and all pass.
 */
export interface RateLimitStore {
  /** Count one request in the window `key` belongs to, opening a window of `windowMs` if none is open. */
  hit(key: string, windowMs: number): Promise<RateLimitEntry>;
  /** Where the window stands, without counting a request. */
  get(key: string): Promise<RateLimitEntry | null>;
  delete(key: string): Promise<void>;
  cleanup?(): Promise<void>;
}

/**
 * In-memory rate limit store (development)
 * Simple Map-based storage for single-instance deployments
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    // Auto-cleanup expired entries every 5 minutes
    if (typeof setInterval !== "undefined") {
      this.cleanupInterval = setInterval(
        () => {
          this.cleanup();
        },
        5 * 60 * 1000,
      );
    }
  }

  async get(key: string): Promise<RateLimitEntry | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check if expired
    if (entry.resetTime < Date.now()) {
      this.store.delete(key);
      return null;
    }

    return { ...entry };
  }

  async hit(key: string, windowMs: number): Promise<RateLimitEntry> {
    // Synchronous access to the Map is atomic within one event-loop tick, and there is no await
    // between the read and the write.
    const now = Date.now();
    const open = this.store.get(key);
    if (open && open.resetTime >= now) {
      open.count += 1;
      return { ...open };
    }
    const entry = { count: 1, resetTime: now + windowMs };
    this.store.set(key, entry);
    return { ...entry };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.store.entries()) {
      if (entry.resetTime < now) {
        this.store.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned ${cleaned} expired rate limit entries`);
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.store.clear();
  }
}

/** How long the first request waits for Redis before it is counted in memory instead. */
const CONNECT_WAIT_MS = 1_500;

/** INCR; expiry when the key has none; reply [count, milliseconds left]. */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/**
 * Redis rate limit store (production)
 * Distributed rate limiting with automatic expiration
 */
export class RedisRateLimitStore implements RateLimitStore {
  private client: {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    connect: () => Promise<void>;
    get: (key: string) => Promise<string | null>;
    pTTL: (key: string) => Promise<number>;
    eval: (script: string, options: { keys: string[]; arguments: string[] }) => Promise<unknown>;
    del: (key: string) => Promise<void>;
    quit: () => Promise<void>;
  } | null = null; // Redis client (dynamically imported)
  private connected = false;
  private initializing = false;
  private initPromise: Promise<void> | null = null;
  private readonly fallback = new MemoryRateLimitStore();
  private waited = false;

  constructor(redisUrl?: string) {
    // Start initialization but don't block constructor
    this.initPromise = this.initializeRedis(redisUrl);
    // Every use awaits it and falls back when it fails; nobody else is left to see the rejection.
    this.initPromise.catch(() => undefined);
  }

  private async initializeRedis(redisUrl?: string): Promise<void> {
    if (this.initializing || this.connected) return;
    this.initializing = true;

    try {
      // Dynamically import Redis client (avoid bundling if not used)
      // Use type assertion to avoid compile-time Redis dependency
      const redis = (await import("redis" as string).catch(() => {
        throw new Error("Redis package not installed. Run: npm install redis");
      })) as {
        createClient: (opts: { url: string }) => {
          on: (event: string, listener: (...args: unknown[]) => void) => void;
          connect: () => Promise<void>;
          get: (key: string) => Promise<string | null>;
          pTTL: (key: string) => Promise<number>;
          eval: (
            script: string,
            options: { keys: string[]; arguments: string[] },
          ) => Promise<unknown>;
          del: (key: string) => Promise<void>;
          quit: () => Promise<void>;
        };
      };

      const url = redisUrl || process.env.REDIS_URL;
      if (!url) {
        throw new Error("Redis URL not configured. Set REDIS_URL environment variable.");
      }

      this.client = redis.createClient({ url });

      this.client.on("error", (err: unknown) => {
        logger.error(
          "Redis connection error",
          err instanceof Error ? err : new Error(String(err)),
          {
            component: "RedisRateLimitStore",
          },
        );
        this.connected = false;
      });

      this.client.on("connect", () => {
        logger.info("Redis rate limit store connected", {
          component: "RedisRateLimitStore",
        });
        this.connected = true;
      });

      await this.client.connect();
    } catch (error) {
      logger.error(
        "Failed to initialize Redis rate limit store",
        error instanceof Error ? error : new Error(String(error)),
        {
          component: "RedisRateLimitStore",
        },
      );
      this.initializing = false;
      throw error;
    }
  }

  /**
   * Wait for the first connection, but not for ever. node-redis keeps retrying a server that is
   * down, so `initPromise` may never settle, and a limiter that waits on it holds every request it
   * guards. The first caller waits a moment; after that, a store that is not connected is answered
   * from memory at once, and starts using Redis the moment its "connect" event fires.
   */
  private async ensureConnected(): Promise<void> {
    if (this.connected || this.waited || !this.initPromise) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.initPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Redis did not connect in time")),
            CONNECT_WAIT_MS,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.waited = true;
    }
  }

  /**
   * Count the request and read the window's remaining life in one Lua script, which Redis runs
   * without interleaving another command: INCR, and the expiry set whenever the key has none (the
   * first hit, or a key that somehow lost it, which would otherwise count for ever).
   *
   * If Redis cannot be reached the request is counted in this process instead. A limiter that stops
   * limiting when its store is down is open to anyone who can make the store fail; per-process
   * counting is weaker than shared counting but is not nothing.
   */
  async hit(key: string, windowMs: number): Promise<RateLimitEntry> {
    try {
      await this.ensureConnected();
    } catch {
      return this.fallback.hit(key, windowMs);
    }
    const client = this.client;
    if (!this.connected || !client) return this.fallback.hit(key, windowMs);

    try {
      const reply = await client.eval(HIT_SCRIPT, {
        keys: [`ratelimit:hit:${key}`],
        arguments: [String(windowMs)],
      });
      const [count, ttl] = reply as [number, number];
      if (typeof count !== "number" || typeof ttl !== "number") {
        throw new Error("Unexpected reply from the rate limit script");
      }
      return { count, resetTime: Date.now() + ttl };
    } catch (error) {
      logger.error("Redis HIT error", error instanceof Error ? error : new Error(String(error)), {
        component: "RedisRateLimitStore",
        key,
      });
      return this.fallback.hit(key, windowMs);
    }
  }

  async get(key: string): Promise<RateLimitEntry | null> {
    try {
      await this.ensureConnected();
    } catch {
      return this.fallback.get(key);
    }
    const client = this.client;
    if (!this.connected || !client) return this.fallback.get(key);

    try {
      const redisKey = `ratelimit:hit:${key}`;
      const [raw, ttl] = await Promise.all([client.get(redisKey), client.pTTL(redisKey)]);
      if (raw === null || ttl < 0) return null;
      return { count: Number(raw), resetTime: Date.now() + ttl };
    } catch (error) {
      logger.error("Redis GET error", error instanceof Error ? error : new Error(String(error)), {
        component: "RedisRateLimitStore",
        key,
      });
      return this.fallback.get(key);
    }
  }

  async delete(key: string): Promise<void> {
    await this.fallback.delete(key);
    try {
      await this.ensureConnected();
    } catch {
      return;
    }
    const client = this.client;
    if (!this.connected || !client) return;

    try {
      await client.del(`ratelimit:hit:${key}`);
    } catch (error) {
      logger.error(
        "Redis DELETE error",
        error instanceof Error ? error : new Error(String(error)),
        {
          component: "RedisRateLimitStore",
          key,
        },
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      await this.client.quit();
      this.connected = false;
    }
  }
}

/**
 * Rate limit store factory
 * Automatically selects appropriate store based on environment
 */
export function createRateLimitStore(): RateLimitStore {
  const useRedis = process.env.REDIS_URL && process.env.NODE_ENV === "production";

  if (useRedis) {
    logger.info("Using Redis rate limit store for production", {
      component: "RateLimitStore",
    });
    return new RedisRateLimitStore();
  } else {
    logger.info("Using in-memory rate limit store for development", {
      component: "RateLimitStore",
    });
    return new MemoryRateLimitStore();
  }
}

// Singleton instance
let storeInstance: RateLimitStore | null = null;

/**
 * Get global rate limit store instance
 */
export function getRateLimitStore(): RateLimitStore {
  if (!storeInstance) {
    storeInstance = createRateLimitStore();
  }
  return storeInstance;
}
