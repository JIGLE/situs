// @vitest-environment node
/**
 * A session that has passed the first factor and not the second is not signed in.
 *
 * `mfaPending` is set at sign-in for an account with TOTP, and cleared when its code is verified
 * (`lib/services/auth/auth.ts`). Nothing used to read it on the server: the code page was the only
 * thing that looked, and nothing sent anyone there, so Settings promised "you will need a code each
 * time" while a request carrying only the password's session was served in full. The proxy now
 * refuses such a session on every portal page and API route, and `requireAuth` refuses it again.
 *
 * Carries real sessions: a mock of `next-auth/jwt` never reaches the proxy (`helpers/session.ts`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { TEST_NEXTAUTH_SECRET, signedInHeaders } from "./helpers/session";

async function run(path: string, headers: Record<string, string> = {}, method = "GET") {
  const { proxy } = await import("../proxy");
  return proxy(new NextRequest(new URL(path, "https://example.test"), { headers, method }));
}

const pending = () => signedInHeaders({ mfaPending: true });
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";
const location = (res: Response) => new URL(res.headers.get("location") as string);

// The first import of the proxy pulls in next/server, the CSRF module and next-auth/jwt; the
// budget is for that module graph, not for the assertions.
describe("proxy: a session waiting for its second factor", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_SECRET", TEST_NEXTAUTH_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("on the API", () => {
    it("is refused with a 401 that names why", async () => {
      const res = await run("/api/properties", await pending());

      expect(res.status).toBe(401);
      expect(passedThrough(res)).toBe(false);
      expect(await res.json()).toEqual({
        error: "Two-factor verification required",
        reason: "mfa_required",
      });
    });

    it.each(["/api/owners", "/api/tenants", "/api/receipts", "/api/bank/transactions"])(
      "is refused on %s",
      async (path) => {
        expect((await run(path, await pending())).status).toBe(401);
      },
    );

    it("is refused for a write before the CSRF check can say anything", async () => {
      const res = await run("/api/owners", await pending(), "POST");

      expect(res.status).toBe(401);
    });

    it("can still send its code: /api/auth/** is not behind the session check", async () => {
      const res = await run("/api/auth/totp/verify", await pending(), "POST");

      expect(res.status).not.toBe(401);
      expect(passedThrough(res)).toBe(true);
    });

    it("is served once its code is verified", async () => {
      for (const claims of [{ mfaPending: false }, {}]) {
        const res = await run("/api/properties", await signedInHeaders(claims));

        expect(res.status).not.toBe(401);
        expect(passedThrough(res)).toBe(true);
      }
    });
  });

  describe("on a portal page", () => {
    it.each(["/dashboard", "/financials", "/owners", "/settings", "/properties"])(
      "is sent to the code page from %s",
      async (path) => {
        const res = await run(path, await pending());

        expect(res.status).toBe(307);
        expect(location(res).pathname).toBe("/auth/mfa");
      },
    );

    it("is sent there from a locale-prefixed path too", async () => {
      const res = await run("/pt/financials", await pending());

      expect(res.status).toBe(307);
      expect(location(res).pathname).toBe("/auth/mfa");
    });

    it("is not sent in a loop: the code page itself is left alone", async () => {
      const res = await run("/auth/mfa", await pending());

      expect(res.headers.get("location")).toBeNull();
    });

    it("reaches the page once its code is verified", async () => {
      const res = await run("/dashboard", await signedInHeaders({ mfaPending: false }));

      // A rewrite to the page has no location; a redirect would name where it goes.
      expect(res.headers.get("location") ?? "").not.toContain("/auth/mfa");
    });
  });
});
