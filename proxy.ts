/**
 * Proxy for Next.js 16+ locale routing, auth enforcement, CSRF, demo mode, and URL redirects.
 * Handles:
 * - Auth guard: 401 for unauthenticated protected API requests; redirect portal pages to sign-in
 * - CSRF validation for state-changing API requests
 * - Locale prefix enforcement (always use /en, /pt, /es, or /it)
 * - Demo mode: /demo entry redirect + route blocking for demo sessions
 * - Backward compatibility redirects from old tab-based URLs
 * - Security headers (CSP, HSTS, X-Frame-Options, etc.)
 */

import { NextRequest, NextResponse } from "next/server";
import { locales, defaultLocale } from "./lib/i18n/config";

import {
  verifyCsrfToken,
  requiresCsrfProtection,
  getOrGenerateCsrfToken,
  setCsrfCookie,
} from "@/lib/middleware/csrf";

/** Internal-only request header marking a path this proxy rewrote. See `alreadyRewritten`. */
const REWRITE_MARKER = "x-situs-locale-rewrite";

// next-auth/jwt typings reference next's GetServerSidePropsContext which may not resolve
// under moduleResolution:bundler — import at the value level only to avoid the tsc error.
const { getToken } = require("next-auth/jwt") as {
  getToken: (params: {
    req: NextRequest;
    secret?: string;
  }) => Promise<Record<string, unknown> | null>;
};

/** Cookie name for demo mode (must match lib/demo/demo-mode.ts) */
const DEMO_COOKIE_NAME = "situs_demo";

/** Paths blocked during demo mode */
const DEMO_BLOCKED_PATTERNS = ["/api/user", "/api/debug"];

// Locales supported by the app (keep in sync with lib/i18n/config.ts)
const SUPPORTED_LOCALES = ["pt", "en", "es", "it"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function isSupportedLocale(segment: string): segment is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(segment);
}

/**
 * Locale for a request that carries no `[locale]` URL segment.
 *
 * The `situs-locale` cookie wins: it is an explicit choice the visitor made through one of the
 * language controls, so it should outrank whatever their browser advertises. `Accept-Language`
 * is the fallback, then `defaultLocale`. Mirrors `lib/i18n/server-locale.ts`, which resolves the
 * same thing for server components — the proxy cannot import it because that module reads
 * `next/headers`.
 */
function resolveLocale(request: NextRequest): string {
  const saved = request.cookies.get("situs-locale")?.value;
  if (saved && isSupportedLocale(saved)) return saved;

  const fromHeader = (request.headers.get("accept-language") ?? "")
    .split(",")
    .map((part) => part.split(";")[0].trim().slice(0, 2).toLowerCase())
    .find(isSupportedLocale);

  return fromHeader ?? defaultLocale;
}

/**
 * Public API prefixes — these routes must never require a session.
 * /api/auth/**           — NextAuth sign-in / callback endpoints
 * /api/health            — Liveness/readiness probe
 * /api/tenant-portal/**  — Token-based tenant self-service API
 * /api/csrf-token        — CSRF token endpoint (GET only, no auth needed)
 * /api/monitoring/**     — Health/metrics probes
 * /api/webhooks/**       — External provider callbacks (Stripe, SIBS, Bizum,
 *                          SendGrid). Authenticated via provider signatures,
 *                          not a user session, so they bypass auth/CSRF.
 * /api/billing/checkout  — Browser-navigable pricing CTA (GET). Self-guards:
 *                          redirects unauthenticated visitors to sign-in and
 *                          requires a session to create a Checkout Session, so
 *                          it must not be 401'd by the proxy first.
 */
function isPublicApiRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth") ||
    pathname === "/api/health" ||
    pathname === "/api/ready" ||
    pathname === "/api/info" ||
    pathname.startsWith("/api/tenant-portal") ||
    pathname === "/api/csrf-token" ||
    pathname.startsWith("/api/monitoring") ||
    pathname.startsWith("/api/webhooks") ||
    pathname === "/api/billing/checkout"
  );
}

/**
 * Generate CSP nonce (Edge-compatible version)
 * Uses Web Crypto API available in Edge runtime
 */
function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

/**
 * Apply security headers to response
 */
function applySecurityHeaders(response: NextResponse, nonce: string): void {
  const headers = response.headers;

  // Pass nonce to the app via custom header
  headers.set("x-nonce", nonce);

  // HSTS: Force HTTPS for 1 year (production only)
  if (process.env.NODE_ENV === "production") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  // X-Frame-Options: Prevent clickjacking
  headers.set("X-Frame-Options", "DENY");

  // X-Content-Type-Options: Prevent MIME sniffing
  headers.set("X-Content-Type-Options", "nosniff");

  // X-XSS-Protection: Legacy XSS protection
  headers.set("X-XSS-Protection", "1; mode=block");

  // Referrer-Policy: Control referrer information
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions-Policy: Disable unnecessary features
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");

  // Content-Security-Policy with nonces (strict CSP)
  const isDev = process.env.NODE_ENV === "development";

  const cspDirectives = [
    "default-src 'self'",
    // Script sources - nonce-based for inline scripts, eval only in dev
    `script-src 'self' 'nonce-${nonce}' https://accounts.google.com https://apis.google.com${isDev ? " 'unsafe-eval'" : ""}`,
    // Style sources - unsafe-inline required for React DOM, Framer Motion, and CSS-in-JS libs
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' https://accounts.google.com https://api.stripe.com https://nominatim.openstreetmap.org${isDev ? " http://localhost:*" : ""}`,
    "frame-src 'self' https://accounts.google.com https://js.stripe.com",
    "object-src 'none'",
    "media-src 'self'",
    "worker-src 'self' blob:",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    // Only upgrade insecure requests in production (avoids https://localhost errors in dev)
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  headers.set("Content-Security-Policy", cspDirectives);
}

export async function proxy(request: NextRequest) {
  // Generate unique nonce for this request
  const nonce = generateNonce();

  const { pathname, searchParams } = request.nextUrl;

  // ── API routes ────────────────────────────────────────────────────
  if (pathname.startsWith("/api/")) {
    // Public routes — pass through without auth or CSRF checks
    if (isPublicApiRoute(pathname)) {
      const response = NextResponse.next();
      applySecurityHeaders(response, nonce);
      return response;
    }

    // Auth check for protected API routes
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      applySecurityHeaders(response, nonce);
      return response;
    }

    // CSRF check for state-changing requests
    if (requiresCsrfProtection(request.method)) {
      if (!verifyCsrfToken(request)) {
        const response = NextResponse.json(
          {
            error: "Invalid CSRF token",
            message: "CSRF token missing or invalid. Please refresh and try again.",
          },
          { status: 403 },
        );
        applySecurityHeaders(response, nonce);
        return response;
      }
    }

    const response = NextResponse.next();
    applySecurityHeaders(response, nonce);
    return response;
  }

  // ── /demo needs no handling any more ────────────────────────────────
  //
  // It used to redirect to `/${defaultLocale}/demo`, which was right while pages lived at
  // prefixed URLs. Once the prefix left the address bar that became an infinite loop: this hop
  // sent `/demo` to `/pt/demo`, and the back-compat rule at the bottom of this file 308s any
  // prefixed URL to its unprefixed form — straight back to `/demo`. Every entry point into demo
  // mode (the landing hero, the PWA welcome screen, the sign-in page) dead-ended in
  // ERR_TOO_MANY_REDIRECTS.
  //
  // Nothing replaces it. `/demo` is already the address the app serves, and the rewrite at the
  // bottom routes it to `app/[locale]/demo` internally, which is all the old redirect was for.

  // ── Legacy property payment path redirects ──────────────────────────
  const legacyPropertyPaymentMatch = pathname.match(
    /^\/(en|pt|es|it)\/(?:portfolio|properties)\/([^/]+)\/(?:payments?|payment-review|review-payments)(?:\/review)?\/?$/,
  );
  if (legacyPropertyPaymentMatch) {
    // The captured locale is no longer needed: the target is the unprefixed path.
    const [, , propertyId] = legacyPropertyPaymentMatch;
    const url = request.nextUrl.clone();
    url.pathname = "/financials";
    url.searchParams.set("tab", "receipts");
    url.searchParams.set("propertyId", propertyId);
    const response = NextResponse.redirect(url, 301);
    applySecurityHeaders(response, nonce);
    return response;
  }

  // ── Demo mode route blocking ────────────────────────────────────────
  const cookieHeader = request.headers.get("cookie") || "";
  const isDemo = cookieHeader.includes(`${DEMO_COOKIE_NAME}=1`);
  if (isDemo) {
    const pathWithoutLocale = pathname.replace(/^\/(pt|en|es|it)(?=\/|$)/, "") || "/";

    const isBlocked = DEMO_BLOCKED_PATTERNS.some(
      (pattern) => pathWithoutLocale === pattern || pathWithoutLocale.startsWith(pattern + "/"),
    );

    if (isBlocked) {
      if (pathWithoutLocale.startsWith("/api/")) {
        const response = NextResponse.json(
          { error: "This feature is not available in demo mode" },
          { status: 403 },
        );
        applySecurityHeaders(response, nonce);
        return response;
      }
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      const response = NextResponse.redirect(url);
      applySecurityHeaders(response, nonce);
      return response;
    }
  }

  // The path as the app thinks of it, with a locale segment stripped when one is present. Both
  // shapes reach here — the address bar is unprefixed now, but a bookmarked `/pt/financials`
  // arrives before it is redirected — and every rule below is about the route, not the language.
  //
  // This used to be `segments[1]`, gated on `isSupportedLocale`, which silently disabled the
  // whole block the moment URLs lost their prefix: the auth guard stopped running (an
  // unauthenticated `/dashboard` rendered the marketing page instead of bouncing to sign-in) and
  // the CSRF cookie stopped being seeded ("Failed to fetch CSRF token" in the console).
  const segments = pathname.split("/").filter(Boolean);
  const appSegments =
    segments.length > 0 && isSupportedLocale(segments[0]) ? segments.slice(1) : segments;
  const appPath = `/${appSegments.join("/")}`;
  const rest = appSegments.join("/");

  // Set when an authenticated portal page needs the CSRF cookie seeded. It is applied to
  // whatever response this function ends up building — returning `NextResponse.next()` here
  // instead would skip the locale rewrite below, and `/dashboard` would route as
  // `[locale] = "dashboard"`, i.e. the landing page.
  let seedCsrfCookie = false;

  const isMainPortalPage =
    rest.startsWith("dashboard") ||
    rest.startsWith("properties") ||
    rest.startsWith("portfolio") ||
    rest.startsWith("tenants") ||
    rest.startsWith("people") ||
    rest.startsWith("leases") ||
    rest.startsWith("buildings") ||
    rest.startsWith("units") ||
    rest.startsWith("contacts") ||
    rest.startsWith("contracts") ||
    rest.startsWith("correspondence") ||
    rest.startsWith("financials") ||
    rest.startsWith("maintenance") ||
    rest.startsWith("reports") ||
    rest.startsWith("analytics") ||
    rest.startsWith("insights") ||
    rest.startsWith("overview") ||
    rest.startsWith("documents") ||
    rest.startsWith("owners") ||
    rest.startsWith("settings");

  if (isMainPortalPage) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    // A valid demo cookie stands in for a session on portal pages — otherwise
    // "Try Demo Mode" bounces straight back to sign-in.
    if (!token && !isDemo) {
      // Sign-in lives at app/auth/signin (outside the [locale] segment). Clone-and-retarget
      // carried the original query onto the sign-in URL and left it out of the callback, so
      // `/financials?tab=tax` became `/auth/signin?tab=tax` and returned you to `/financials`
      // on the default tab. The query belongs in the callback and nowhere else.
      const signInUrl = new URL("/auth/signin", request.nextUrl.origin);
      signInUrl.searchParams.set("callbackUrl", `${pathname}${request.nextUrl.search}`);
      const response = NextResponse.redirect(signInUrl);
      applySecurityHeaders(response, nonce);
      return response;
    }

    // Seed CSRF cookie for portal pages (needed by the API client)
    seedCsrfCookie = !request.cookies.get("csrf-token")?.value;
  }

  // Preserve canonical financial tab routes used by the current UI.
  const isFinancialsPath = appPath === "/financials";
  const canonicalFinancialTabs = new Set(["queue", "receipts", "rent-roll", "tax"]);

  // Handle old tab-based URL redirects (backward compatibility)
  const tab = searchParams.get("tab");
  // A canonical tab is not a legacy alias — it must not be rewritten by the map below, and it
  // must not return `next()` either, for the same reason the CSRF seed above no longer does.
  if (tab && !(isFinancialsPath && canonicalFinancialTabs.has(tab))) {
    const tabRouteMap: Record<string, string | { path: string; financialTab?: string }> = {
      overview: "/dashboard",
      properties: "/portfolio",
      tenants: "/people",
      leases: "/leases",
      financials: "/financials",
      receipts: { path: "/financials", financialTab: "receipts" },
      expenses: { path: "/financials", financialTab: "queue" },
      invoices: { path: "/financials", financialTab: "receipts" },
      "payment-matrix": { path: "/financials", financialTab: "receipts" },
      maintenance: "/maintenance",
      owners: "/owners",
      correspondence: "/correspondence",
      reports: "/reports",
      analytics: "/analytics",
      settings: "/settings",
      profile: "/settings/profile",
      preferences: "/settings/preferences",
      admin: "/settings/admin",
    };

    const mapping = tabRouteMap[tab as keyof typeof tabRouteMap];
    if (mapping) {
      const url = request.nextUrl.clone();
      const path = typeof mapping === "string" ? mapping : mapping.path;
      url.pathname = path;
      url.searchParams.delete("tab");
      url.searchParams.delete("subtab");
      if (typeof mapping !== "string" && mapping.financialTab) {
        url.searchParams.set("tab", mapping.financialTab);
      }
      const response = NextResponse.redirect(url, 301);
      applySecurityHeaders(response, nonce);
      return response;
    }
  }

  // Handle old subtab-based URLs for financials
  const subtab = searchParams.get("subtab");
  if (subtab && appPath.startsWith("/financials")) {
    const subtabRouteMap: Record<string, string> = {
      receipts: "receipts",
      expenses: "queue",
      invoices: "receipts",
      "payment-matrix": "receipts",
    };

    const financialTab = subtabRouteMap[subtab];
    if (financialTab) {
      const url = request.nextUrl.clone();
      url.pathname = "/financials";
      url.searchParams.delete("subtab");
      url.searchParams.set("tab", financialTab);
      const response = NextResponse.redirect(url, 301);
      applySecurityHeaders(response, nonce);
      return response;
    }
  }

  // Check if pathname already starts with a supported locale
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
  );

  /**
   * On the standalone server — the one the Dockerfile runs and the one CI boots — this proxy
   * runs AGAIN on the path it rewrote to. That makes the two branches below, each correct on
   * its own, mutually recursive: `/` is rewritten to `/pt`, the second pass sees a locale
   * prefix and 308s it back to `/`, and the browser gives up with ERR_TOO_MANY_REDIRECTS on
   * the home page. Under `next start` there is no second pass, which is why every local check
   * missed it. It is invisible to the mobile-audit ratchet too: an unreachable surface lands
   * in `failedToLoad`, and BASELINE does not include that key, so the gate stays green while
   * the front door is shut.
   *
   * Suppressing only the 308 is not enough. The second pass then takes the rewrite branch
   * instead and asks for `/pt/pt`, then `/pt/pt/pt`, until the request simply never answers —
   * which is what the first attempt at this fix actually produced. The second pass has to do
   * nothing at all.
   *
   * A client can set this header on its own request. That costs it the locale rewrite and
   * earns it a 404, and nothing more: every auth, portal and rate-limit check above this
   * point has already run by the time we get here.
   */
  const alreadyRewritten = request.headers.get(REWRITE_MARKER) !== null;

  // Routes that intentionally live outside the [locale] segment — prepending a
  // locale would 404 them: the auth pages (app/auth/**) and the token-based
  // tenant portal (app/tenant-portal/**).
  const isLocaleExemptPath =
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/tenant-portal" ||
    pathname.startsWith("/tenant-portal/");

  let response: NextResponse;

  if (isLocaleExemptPath || alreadyRewritten) {
    response = NextResponse.next();
  } else if (pathnameHasLocale) {
    // The prefix is no longer part of the address. Old links, bookmarks, anything still building
    // `/pt/foo` by hand, and the app's own hrefs until they are migrated all arrive here and are
    // sent to the clean form. 308 rather than 307: this is permanent, and 308 is the one browsers
    // and caches may remember.
    //
    // The locale is NOT discarded — it is written to the cookie that `resolveLocale` reads, so
    // following `/es/dashboard` still lands you in Spanish. Dropping it would silently switch a
    // deliberately shared link back to the visitor's own language.
    const requested = pathname.split("/")[1];
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/(pt|en|es|it)/, "") || "/";
    response = NextResponse.redirect(url, { status: 308 });
    if (isSupportedLocale(requested)) {
      response.cookies.set("situs-locale", requested, {
        path: "/",
        maxAge: 31536000,
        sameSite: "lax",
      });
    }
  } else {
    // Rewritten, not redirected: the browser keeps showing `/dashboard` while Next.js routes
    // `/[locale]/dashboard`, so `app/[locale]/**` is untouched and the address bar loses the
    // segment. `resolveLocale` reads the cookie first, then Accept-Language — the same order
    // `lib/i18n/server-locale.ts` uses.
    const url = request.nextUrl.clone();
    url.pathname = `/${resolveLocale(request)}${pathname === "/" ? "" : pathname}`;
    // Carried on the rewritten request so the second pass can tell "the visitor typed /pt"
    // from "we just put the /pt there ourselves". Without it the two are indistinguishable.
    const rewrittenHeaders = new Headers(request.headers);
    rewrittenHeaders.set(REWRITE_MARKER, "1");
    response = NextResponse.rewrite(url, { request: { headers: rewrittenHeaders } });
  }

  applySecurityHeaders(response, nonce);
  if (seedCsrfCookie) {
    setCsrfCookie(response, getOrGenerateCsrfToken(request));
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|version\\.json|sw\\.js|manifest\\.webmanifest|offline\\.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json|webmanifest|txt|woff2?)$).*)",
  ],
};
