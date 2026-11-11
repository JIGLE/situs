// @vitest-environment node
/**
 * Leases is Portfolio's Leases tab. `/leases` and `/contracts` answer with a redirect there before
 * anything renders, keeping their query, and `/portfolio?tab=leases` is a live tab, not the legacy
 * `?tab=leases` alias that used to send any page to `/leases`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { TEST_NEXTAUTH_SECRET, signedInHeaders } from "./helpers/session";

async function run(path: string, headers: Record<string, string> = {}) {
  const { proxy } = await import("../proxy");
  return proxy(new NextRequest(new URL(path, "https://example.test"), { headers }));
}

const location = (res: Response) => new URL(res.headers.get("location") as string);

// The first import of the proxy pulls in next/server, the CSRF module and next-auth/jwt; the
// budget is for that module graph, not for the assertions.
describe("proxy: Leases in Portfolio", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_SECRET", TEST_NEXTAUTH_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["/leases", "/pt/leases", "/contracts"])(
    "sends %s to Portfolio's Leases tab, keeping the link's query",
    async (path) => {
      const res = await run(`${path}?action=create&tenantId=t-1`, await signedInHeaders());

      expect(res.status).toBe(307);
      expect(location(res).pathname).toBe("/portfolio");
      expect(location(res).searchParams.get("tab")).toBe("leases");
      expect(location(res).searchParams.get("action")).toBe("create");
      expect(location(res).searchParams.get("tenantId")).toBe("t-1");
    },
  );

  it("leaves a lease's own page alone", async () => {
    const res = await run("/leases/lease-1", await signedInHeaders());

    expect(res.headers.get("location")).toBeNull();
  });

  it("lets Portfolio's Leases tab through", async () => {
    const res = await run("/portfolio?tab=leases", await signedInHeaders());

    expect(res.headers.get("location")).toBeNull();
  });
});
