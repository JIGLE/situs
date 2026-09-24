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
 * No mock of `next-auth/jwt` here. The proxy loads `getToken` with `require`, which `vi.mock`
 * does not reach: a mocked token never arrived, and the real `getToken` answered instead. The
 * signed-in case therefore carries a real session, encoded with the library's own `encode`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const SECRET = "proxy-root-redirect-test-secret-0123456789";

async function run(path: string, headers: Record<string, string> = {}) {
  const { proxy } = await import("../proxy");
  return proxy(new NextRequest(new URL(path, "https://example.test"), { headers }));
}

/**
 * `getToken` reads a bearer token as well as the session cookie and decodes both the same way.
 * The header keeps the test independent of which cookie name `NEXTAUTH_URL` selects.
 */
async function signedIn(): Promise<Record<string, string>> {
  // Loaded the way proxy.ts loads `getToken`, and typed by hand for the reason it gives: the
  // package's typings do not resolve under this project's module resolution.
  const { encode } = require("next-auth/jwt") as {
    encode: (params: { token: Record<string, unknown>; secret: string }) => Promise<string>;
  };
  const token = await encode({
    token: { sub: "user-1", email: "owner@example.test" },
    secret: SECRET,
  });
  return { authorization: `Bearer ${token}` };
}

const location = (res: Response) => new URL(res.headers.get("location") as string);

// The first import of the proxy pulls in next/server, the CSRF module and next-auth/jwt; the
// budget is for that module graph, not for the assertions.
describe("proxy: the root", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_SECRET", SECRET);
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
    const res = await run("/", await signedIn());

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
