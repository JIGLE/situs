// @vitest-environment node
/**
 * The home page 308-redirected to itself on the standalone server — the build the Dockerfile
 * runs and the one CI boots — and nothing caught it.
 *
 * The cause was two correct branches of `proxy.ts` forming a cycle. `/` is rewritten to
 * `/{locale}` so `app/[locale]/**` can own the route while the address bar stays clean; a
 * locale-prefixed path is 308'd back to the clean form so old links still work. On the
 * standalone server the proxy runs a second time on the path it rewrote to, so the rewrite
 * fed the redirect and the browser gave up with ERR_TOO_MANY_REDIRECTS.
 *
 * Three things kept it hidden, which is why the guard belongs here rather than in a smoke check:
 *   - `next start` does not re-enter the proxy, so every local check passed.
 *   - The mobile audit counts an unreachable surface in `failedToLoad`, and BASELINE — the
 *     thing `--strict` actually ratchets — does not include that key.
 *   - The first attempt at a fix suppressed only the redirect, at which point the second pass
 *     took the rewrite branch instead and asked for `/pt/pt`, `/pt/pt/pt`, … The request then
 *     hung rather than erroring, which looks like a slow page, not a routing bug.
 *
 * The signed-in case carries a real session: a mock of `next-auth/jwt` never reaches the proxy
 * (`helpers/session.ts`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { TEST_NEXTAUTH_SECRET, signedInHeaders } from "./helpers/session";

const MARKER = "x-situs-locale-rewrite";

async function run(path: string, headers: Record<string, string> = {}) {
  const { proxy } = await import("../proxy");
  return proxy(
    new NextRequest(new URL(path, "https://example.test"), { headers: new Headers(headers) }),
  );
}

// The first `import("../proxy")` pulls in next/server, the CSRF module and next-auth/jwt, which
// takes well past the 5s default when the full suite is running in parallel. The assertions
// themselves are microseconds; this budget is for the module graph, not the work.
describe("proxy locale rewrite", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_SECRET", TEST_NEXTAUTH_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // `/` itself no longer comes this way: it redirects (proxy-root-redirect.test.ts). Every other
  // clean path does, and `/privacy` needs no session, so it reaches the rewrite.
  it("rewrites a clean path to a locale segment and marks the rewrite", async () => {
    const res = await run("/privacy");
    const rewritten = res.headers.get("x-middleware-rewrite");
    expect(rewritten, "a clean path must be rewritten, not redirected").toBeTruthy();
    expect(new URL(rewritten as string).pathname).toMatch(/^\/(pt|en|es|it)\/privacy$/);

    // Next encodes request headers set on a rewrite as `x-middleware-request-<name>`. Asserting
    // it here is what makes the pass-through test below meaningful: without the marker actually
    // reaching the second pass, that test would be checking a header nobody ever sets.
    expect(res.headers.get(`x-middleware-request-${MARKER}`)).toBe("1");
  });

  // Almost every page needs a session, so this is the rewrite an owner's page loads take: past
  // the auth guard, then into the same locale block.
  it("rewrites a signed-in owner's page the same way", async () => {
    const res = await run("/dashboard", await signedInHeaders());
    const rewritten = res.headers.get("x-middleware-rewrite");
    expect(rewritten, "a signed-in page must be rewritten, not sent to sign-in").toBeTruthy();
    expect(new URL(rewritten as string).pathname).toMatch(/^\/(pt|en|es|it)\/dashboard$/);
    expect(res.headers.get(`x-middleware-request-${MARKER}`)).toBe("1");
  });

  // A public path: the auth guard runs earlier in the proxy and 307s a protected one to
  // sign-in before the locale block is ever reached.
  it("308s an externally requested locale prefix back to the clean path", async () => {
    const res = await run("/pt");
    expect(res.status).toBe(308);
    expect(new URL(res.headers.get("location") as string).pathname).toBe("/");
  });

  // The regression guard. Revert either half of the fix and this fails: without the marker
  // check the second pass 308s (the redirect loop), and with a marker check that only
  // suppresses the redirect it rewrites again (the hang).
  it("passes a path it already rewrote straight through", async () => {
    const res = await run("/pt", { [MARKER]: "1" });

    expect(res.status, "a second pass must not redirect — that is the loop").toBe(200);
    const rewritten = res.headers.get("x-middleware-rewrite");
    const rewrittenPath = rewritten ? new URL(rewritten).pathname : null;
    expect(
      rewrittenPath,
      "a second pass must not rewrite again — that is the /pt/pt/pt hang",
    ).toBeNull();
  });
});
