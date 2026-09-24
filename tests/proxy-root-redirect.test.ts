// @vitest-environment node
/**
 * `/` has no page of its own, and the proxy answers it with a 307 before anything renders.
 *
 * The page's own `redirect()` could not do the job. `app/[locale]/loading.tsx` puts the page
 * behind a Suspense boundary, so the response is already streaming when the page runs, and Next
 * then sends a redirect only as a client-side meta refresh. The E2E smoke test loaded `/` signed
 * out and was still on `/` after the load event; the page's unit test, which checks that
 * `redirect()` is called, passed throughout.
 *
 * The signed-in case carries a real session: a mock of `next-auth/jwt` never reaches the proxy
 * (`helpers/session.ts`).
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
describe("proxy: the root", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_SECRET", TEST_NEXTAUTH_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends a signed-out visitor to sign-in with a real redirect", async () => {
    const res = await run("/");

    expect(res.status).toBe(307);
    expect(location(res).pathname).toBe("/auth/signin");
  });

  it("sends a signed-in owner to the dashboard", async () => {
    const res = await run("/", await signedInHeaders());

    expect(res.status).toBe(307);
    expect(location(res).pathname).toBe("/dashboard");
  });

  // The legacy `?tab=` map exists for old bookmarks of `/`, so it has to run first.
  it("still sends an old bookmark of / with a tab where the tab lives now", async () => {
    const res = await run("/?tab=receipts");

    expect(res.status).toBe(301);
    expect(location(res).pathname).toBe("/financials");
    expect(location(res).searchParams.get("tab")).toBe("receipts");
  });

  // `/pt` is the root in Portuguese. It keeps the 308 that writes its language to the cookie,
  // and comes back as `/`.
  it("leaves a locale-prefixed root to the redirect that keeps its language", async () => {
    const res = await run("/pt");

    expect(res.status).toBe(308);
    expect(location(res).pathname).toBe("/");
    expect(res.cookies.get("situs-locale")?.value).toBe("pt");
  });
});
