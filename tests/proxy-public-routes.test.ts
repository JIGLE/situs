/**
 * Which `/api` paths the proxy lets through without a session.
 *
 * `isPublicApiRoute` is an allowlist in front of every route handler: a path on it skips both the
 * session check and the CSRF check, so it has to name exactly the routes that authenticate some
 * other way. `/api/metrics` was missing from it, so a Prometheus scraper — which has no session —
 * got 401 from the proxy before the route's own bearer check could run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => null) }));

async function run(path: string) {
  const { proxy } = await import("../proxy");
  return proxy(new NextRequest(new URL(path, "https://example.test")));
}

/** `NextResponse.next()` — the proxy handed the request on to the route. */
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

// The first import of the proxy pulls in next/server, the CSRF module and next-auth/jwt; the
// budget is for that module graph, not for the assertions.
describe("proxy: API routes without a session", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("lets a scraper reach /api/metrics, which checks its own bearer", async () => {
    const res = await run("/api/metrics");

    expect(res.status).not.toBe(401);
    expect(passedThrough(res)).toBe(true);
  });

  it("answers 401 for a route that needs a session", async () => {
    const res = await run("/api/tenants");

    expect(res.status).toBe(401);
    expect(passedThrough(res)).toBe(false);
  });

  // The tenant portal was deleted with the scope cutdown, but its prefix stayed on the list — so
  // any route added under it later would have been born without auth or CSRF.
  it("does not exempt the deleted tenant portal's prefix", async () => {
    const res = await run("/api/tenant-portal/anything");

    expect(res.status).toBe(401);
    expect(passedThrough(res)).toBe(false);
  });
});
