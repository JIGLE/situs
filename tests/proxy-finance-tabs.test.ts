// @vitest-environment node
/**
 * A Finance tab that was removed or folded into another keeps its links working: the proxy sends
 * each to the tab that holds its content now, and lets the live tabs through untouched.
 *
 * "Ocupação e renda" (`?tab=rent-roll`) was folded into the rent matrix. Listed as a live tab, it
 * passed through, and the page showed the matrix under an address naming a tab that no longer
 * exists.
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
describe("proxy: Finance tabs", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_SECRET", TEST_NEXTAUTH_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends Ocupação e renda to the rent matrix, keeping the rest of the link", async () => {
    const res = await run(
      "/financials?tab=rent-roll&month=lease-1:2026-08",
      await signedInHeaders(),
    );

    expect(res.status).toBe(301);
    expect(location(res).pathname).toBe("/financials");
    expect(location(res).searchParams.get("tab")).toBe("rent-matrix");
    expect(location(res).searchParams.get("month")).toBe("lease-1:2026-08");
  });

  it.each(["receipts", "rent-matrix", "bank", "tax"])("lets the %s tab through", async (tab) => {
    const res = await run(`/financials?tab=${tab}`, await signedInHeaders());

    expect(res.headers.get("location")).toBeNull();
  });
});
