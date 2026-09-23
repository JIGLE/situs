import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Without this the route short-circuits in the test environment, which has no DATABASE_URL.
vi.mock("@/lib/config/data-mode", () => ({ isMockMode: false }));

import { POST } from "./route";

/**
 * A request as a single trusted reverse proxy delivers it: whatever `X-Forwarded-For` the caller
 * sent, with the address the proxy actually saw appended on the right.
 */
function viaProxy(spoofed: string, realClient: string) {
  return new Request("http://localhost/api/debug/db/init", {
    method: "POST",
    headers: {
      authorization: "Bearer wrong-secret",
      "x-forwarded-for": `${spoofed}, ${realClient}`,
    },
  });
}

describe("POST /api/debug/db/init rate limit", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INIT_SECRET", "init-secret");
    vi.stubEnv("TRUSTED_PROXY_COUNT", undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // Reading X-Forwarded-For from the left let a caller pick a fresh bucket per request by
  // changing what they sent; the limit only counts once it keys on the address the proxy saw.
  it("keys on the client the proxy saw, not the X-Forwarded-For the caller wrote", async () => {
    const client = "203.0.113.7";
    for (let i = 1; i <= 5; i++) {
      const res = await POST(viaProxy(`10.0.0.${i}`, client));
      expect(res.status).toBe(401);
    }

    const sixth = await POST(viaProxy("10.0.0.6", client));

    expect(sixth.status).toBe(429);
  });

  it("keeps separate clients in separate buckets", async () => {
    for (let i = 1; i <= 5; i++) {
      await POST(viaProxy("10.0.0.1", "198.51.100.1"));
    }

    const other = await POST(viaProxy("10.0.0.1", "198.51.100.2"));

    expect(other.status).toBe(401);
  });
});
