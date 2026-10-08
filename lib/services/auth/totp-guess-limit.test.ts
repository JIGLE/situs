// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/middleware/rate-limit";
import { totpGuessLimit } from "./totp-guess-limit";

/**
 * The budget for guessing a second-factor code is one per account, not one per URL.
 *
 * Run against the real limiter and its in-memory store: a test that mocks `rateLimit` sees only the
 * config it is handed, and the first version of the disable route handed it the verify route's
 * identifier while the limiter, which keys on the path as well, kept two buckets.
 */

const VERIFY = "https://example.test/api/auth/totp/verify";
const DISABLE = "https://example.test/api/auth/totp/disable";
const post = (url: string) => new Request(url, { method: "POST" });

let user = 0;
const nextUser = () => `limit-user-${++user}-${Date.now()}`;

beforeEach(() => {
  delete process.env.E2E_DISABLE_RATE_LIMIT;
  delete process.env.REDIS_URL;
});

const spent = async (url: string, userId: string) =>
  (await rateLimit(post(url), totpGuessLimit(userId)))?.status === 429;

describe("totpGuessLimit", () => {
  it("lets five guesses through and refuses the sixth", async () => {
    const id = nextUser();
    for (let i = 0; i < 5; i++) expect(await spent(VERIFY, id)).toBe(false);
    expect(await spent(VERIFY, id)).toBe(true);
  });

  it("counts a guess at either route against the same five", async () => {
    const id = nextUser();
    for (const url of [VERIFY, DISABLE, VERIFY, DISABLE, VERIFY]) {
      expect(await spent(url, id)).toBe(false);
    }

    expect(await spent(DISABLE, id)).toBe(true);
    expect(await spent(VERIFY, id)).toBe(true);
  });

  it("keeps one account's guesses from spending another's", async () => {
    const a = nextUser();
    const b = nextUser();
    for (let i = 0; i < 6; i++) await spent(VERIFY, a);

    expect(await spent(DISABLE, a)).toBe(true);
    expect(await spent(DISABLE, b)).toBe(false);
  });

  it("leaves a limit without a scope keyed on its path, as every other route is", async () => {
    const id = nextUser();
    const same = { maxRequests: 1, windowSeconds: 60, identifier: () => id };

    expect(await rateLimit(post(VERIFY), same)).toBeNull();
    // A different path is a different bucket for it.
    expect(await rateLimit(post(DISABLE), same)).toBeNull();
    expect((await rateLimit(post(VERIFY), same))?.status).toBe(429);
  });
});
