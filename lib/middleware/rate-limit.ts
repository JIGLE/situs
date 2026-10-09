/**
 * Rate Limiting Middleware
 *
 * Protects API endpoints from abuse, brute force attacks, and DDoS.
 * Uses Redis for production (distributed), in-memory for development.
 */

import { getRateLimitStore } from "./rate-limit-store";
import { resolveClientIp } from "@/lib/utils/security";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export interface RateLimitConfig {
  /**
   * Maximum number of requests allowed in the time window
   */
  maxRequests: number;

  /**
   * Time window in seconds
   */
  windowSeconds: number;

  /**
   * Custom identifier function (default uses IP address)
   */
  identifier?: (request: Request) => string;

  /**
   * Name of the bucket, in place of the request path. Routes that answer the same question share a
   * bucket by naming the same scope: one account's guesses at a second-factor code count together
   * whichever route they reach, rather than once per URL. Absent, the bucket is the path's own.
   */
  scope?: string;

  /**
   * Skip rate limiting based on condition
   */
  skip?: (request: Request) => boolean;
}

/**
 * Default rate limit configurations for different endpoint types
 */
export const RateLimits = {
  /** General API endpoints - 100 requests per minute */
  API: { maxRequests: 100, windowSeconds: 60 },

  /** Authentication endpoints - 5 requests per 15 minutes */
  AUTH: { maxRequests: 5, windowSeconds: 15 * 60 },

  /** Payment endpoints - 10 requests per minute */
  PAYMENT: { maxRequests: 10, windowSeconds: 60 },

  /** Webhook endpoints - 30 requests per minute */
  WEBHOOK: { maxRequests: 30, windowSeconds: 60 },

  /** Public endpoints - 200 requests per minute */
  PUBLIC: { maxRequests: 200, windowSeconds: 60 },

  /** Strict rate limit for sensitive operations - 3 requests per hour */
  STRICT: { maxRequests: 3, windowSeconds: 60 * 60 },
} as const;

/**
 * Get client identifier from request (IP address by default)
 */
function getClientIdentifier(request: Request): string {
  // Shared resolver: counts X-Forwarded-For from the right so a caller cannot choose their own
  // bucket by prepending a value. See lib/utils/security.ts.
  return resolveClientIp(request);
}

/**
 * Apply rate limiting to a request
 *
 * @param request - The incoming request
 * @param config - Rate limit configuration
 * @returns Response with 429 status if rate limit exceeded, null otherwise
 */
export async function rateLimit(
  request: Request,
  config: RateLimitConfig,
): Promise<Response | null> {
  // Opt-out for the E2E suite only.
  //
  // The general API limit is 100 requests per minute per IP, and the whole Playwright suite runs
  // from one address: ~90 tests, each loading pages that fan out to several endpoints. It blows
  // through the window partway and the tail of the run fails with 429s that look like product
  // bugs — a POST /api/properties returning 429 instead of 201, a Select rendering no options.
  // Deliberately named for its only caller so it cannot be mistaken for a general kill switch,
  // and set nowhere but the E2E job in .github/workflows/ci.yml.
  if (process.env.E2E_DISABLE_RATE_LIMIT === "true") {
    return null;
  }

  // Check if we should skip rate limiting
  if (config.skip && config.skip(request)) {
    return null;
  }

  // Get rate limit store (Redis in production, memory in dev)
  const store = getRateLimitStore();

  // Get client identifier
  const identifier = config.identifier ? config.identifier(request) : getClientIdentifier(request);

  // Create a unique key for this client + endpoint combination
  const url = new URL(request.url);
  const key = `${identifier}:${config.scope ?? url.pathname}`;

  const now = Date.now();

  // One atomic step: count this request and read where the window stands.
  const entry = await store.hit(key, config.windowSeconds * 1000);

  // Check if rate limit exceeded
  if (entry.count > config.maxRequests) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetTime - now) / 1000));

    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        message: `Too many requests. Please try again in ${retryAfter} seconds.`,
        retryAfter,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": retryAfter.toString(),
          "X-RateLimit-Limit": config.maxRequests.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": entry.resetTime.toString(),
        },
      },
    );
  }

  return addRateLimitHeaders(null, config, entry);
}

/**
 * Add rate limit headers to a response
 */
function addRateLimitHeaders(
  _response: Response | null,
  _config: RateLimitConfig,
  _entry: RateLimitEntry,
): Response | null {
  // If there's no response, we're just passing through (not rate limited)
  // Return null to indicate success
  return null;
}

/**
 * Create a rate limit wrapper for API routes
 *
 * @example
 * ```typescript
 * export async function POST(request: Request) {
 *   const rateLimitResponse = await rateLimit(request, RateLimits.PAYMENT);
 *   if (rateLimitResponse) return rateLimitResponse;
 *
 *   // Handle request normally
 * }
 * ```
 */
export function createRateLimiter(config: RateLimitConfig) {
  return (request: Request) => rateLimit(request, config);
}

/**
 * Get current rate limit status for a client
 */
export async function getRateLimitStatus(
  request: Request,
  config: RateLimitConfig,
): Promise<{
  limit: number;
  remaining: number;
  reset: number;
}> {
  const store = getRateLimitStore();
  const identifier = config.identifier ? config.identifier(request) : getClientIdentifier(request);

  const url = new URL(request.url);
  const key = `${identifier}:${config.scope ?? url.pathname}`;

  const entry = await store.get(key);

  if (!entry) {
    return {
      limit: config.maxRequests,
      remaining: config.maxRequests,
      reset: Date.now() + config.windowSeconds * 1000,
    };
  }

  return {
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - entry.count),
    reset: entry.resetTime,
  };
}
