import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { apiFetch, csrfHeaders, getCsrfTokenFromDocument } from "./api-client";

/**
 * Regression cover for the two CSRF defects found in the 2026-08 sweep:
 *
 *  1. `apiFetch(url, csrfToken, "DELETE")` silently issued a **GET** whenever `csrfToken` was
 *     null — signature dispatch keyed off `typeof csrfTokenOrOptions === "object"`, and
 *     `typeof null === "object"`. `useCsrf()` returns `string | null` and is null until its
 *     token fetch resolves, so every call site could hit this. The request returned 200 having
 *     mutated nothing, so callers reported success.
 *  2. Mutating requests carried no `x-csrf-token` header at all unless the caller threaded one
 *     in by hand, and `proxy.ts` 403s those.
 */

function mockFetchOnce(body: unknown = { ok: true }) {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function setCookie(value: string | null) {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => (value === null ? "" : `csrf-token=${value}`),
  });
}

beforeEach(() => {
  setCookie("tok-from-cookie");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getCsrfTokenFromDocument", () => {
  it("reads the token from the cookie", () => {
    expect(getCsrfTokenFromDocument()).toBe("tok-from-cookie");
  });

  it("returns null when the cookie is absent", () => {
    setCookie(null);
    expect(getCsrfTokenFromDocument()).toBeNull();
  });

  it("picks the right cookie when others surround it", () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "situs-locale=it; csrf-token=abc123; other=x",
    });
    expect(getCsrfTokenFromDocument()).toBe("abc123");
  });
});

describe("csrfHeaders", () => {
  it("merges the token with supplied headers", () => {
    expect(csrfHeaders({ "Content-Type": "application/json" })).toEqual({
      "Content-Type": "application/json",
      "x-csrf-token": "tok-from-cookie",
    });
  });

  it("omits the header when no cookie is present rather than sending an empty one", () => {
    setCookie(null);
    expect(csrfHeaders()).toEqual({});
  });
});

describe("apiFetch signature dispatch", () => {
  it("honours the method when the CSRF token is null (regression: silently became GET)", async () => {
    const spy = mockFetchOnce();

    await apiFetch("/api/things/1", null, "DELETE");

    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0];
    expect(init.method).toBe("DELETE");
  });

  it("still honours an explicit options object", async () => {
    const spy = mockFetchOnce();

    await apiFetch("/api/things", { method: "POST", body: JSON.stringify({ a: 1 }) });

    const [, init] = spy.mock.calls[0];
    expect(init.method).toBe("POST");
  });

  it("sends the body given via the convenience signature", async () => {
    const spy = mockFetchOnce();

    await apiFetch("/api/things", "tok", "POST", { a: 1 });

    const [, init] = spy.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });
});

describe("apiFetch CSRF header", () => {
  it("uses an explicitly supplied token", async () => {
    const spy = mockFetchOnce();

    await apiFetch("/api/things", "explicit-token", "POST", {});

    expect(spy.mock.calls[0][1].headers["X-CSRF-Token"]).toBe("explicit-token");
  });

  it("falls back to the cookie when no token is threaded through", async () => {
    const spy = mockFetchOnce();

    await apiFetch("/api/things", null, "POST", {});

    expect(spy.mock.calls[0][1].headers["X-CSRF-Token"]).toBe("tok-from-cookie");
  });

  it("does not attach the header to safe methods", async () => {
    const spy = mockFetchOnce();

    await apiFetch("/api/things", null, "GET");

    expect(spy.mock.calls[0][1].headers["X-CSRF-Token"]).toBeUndefined();
  });

  it("throws instead of firing an unprotected mutation when no token exists anywhere", async () => {
    setCookie(null);
    mockFetchOnce();

    await expect(apiFetch("/api/things", null, "POST", {})).rejects.toMatchObject({ status: 403 });
  });
});

describe("apiFetch: a refused request", () => {
  it("keeps the route's reason on the error, so the screen can say why", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: async () => ({ error: "kept", reason: "tenant_has_history" }),
      }),
    );

    await expect(apiFetch("/api/tenants/t-1", "tok", "DELETE")).rejects.toMatchObject({
      status: 409,
      reason: "tenant_has_history",
    });
  });
});
