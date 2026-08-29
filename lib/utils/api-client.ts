/**
 * Secure API Client with CSRF Protection
 *
 * Provides type-safe API calls with automatic CSRF token injection
 */

import { logger } from "./logger";

interface ApiClientOptions extends RequestInit {
  csrfToken?: string | null;
}

interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
  /** Set by `createErrorResponse` for a `ValidationError` — which input was rejected. */
  field?: string;
}

/**
 * Read the CSRF token straight off the cookie.
 *
 * The double-submit-cookie pattern requires the token to be readable by our own JavaScript so
 * it can be echoed back in the `x-csrf-token` header — `lib/middleware/csrf.ts` sets the cookie
 * with `httpOnly: false` for exactly this reason. The protection comes from the same-origin
 * policy (a cross-origin attacker can neither read this cookie nor set the custom header) and
 * from `sameSite: "strict"`, not from hiding the value from first-party script.
 *
 * `app/api/csrf-token/route.ts` returns the *same* value in its body that it writes to the
 * cookie, and `proxy.ts` seeds the cookie on page navigations, so this is equivalent to the
 * token held in `CsrfContext` — just reachable from code that has no React context, such as
 * module-level analytics helpers.
 */
export function getCsrfTokenFromDocument(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Build headers for a hand-rolled `fetch` that uses a state-changing method.
 *
 * `proxy.ts` rejects every non-public `/api/*` POST/PUT/PATCH/DELETE that arrives without a
 * matching `x-csrf-token` header, so a raw `fetch` without one always 403s. Prefer `apiFetch`
 * for new code; this exists for call sites whose existing response handling (`res.ok`,
 * streaming, `Promise.allSettled` over many requests) does not fit `apiFetch`'s
 * parse-or-throw contract.
 */
export function csrfHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getCsrfTokenFromDocument();
  return {
    ...(extra ?? {}),
    ...(token ? { "x-csrf-token": token } : {}),
  };
}

/**
 * Enhanced fetch wrapper with CSRF token support
 *
 * Supports two call signatures:
 * 1. apiFetch(url, options) - Full options object
 * 2. apiFetch(url, csrfToken, method, body) - Convenient signature for CRUD operations
 *
 * @param url - API endpoint URL
 * @param csrfTokenOrOptions - CSRF token string or full options object
 * @param httpMethod - HTTP method (only used with signature 2)
 * @param body - Request body (only used with signature 2)
 * @returns Parsed JSON response
 */
export async function apiFetch<T = unknown>(
  url: string,
  csrfTokenOrOptions?: string | null | ApiClientOptions,
  httpMethod?: string,
  body?: unknown,
  isRetry?: boolean,
): Promise<T> {
  // Determine if using signature 1 (options object) or signature 2 (separate params).
  //
  // Dispatch keys off `httpMethod` rather than `typeof csrfTokenOrOptions`. The old check was
  // `typeof csrfTokenOrOptions === "object"`, and `typeof null === "object"` — so a perfectly
  // ordinary `apiFetch(url, csrfToken, "DELETE")` where `useCsrf()` had not yet resolved its
  // token (it is `string | null`, null until the token fetch returns) fell into the
  // options-object branch, collapsed to `{}`, and silently issued a **GET**. The request came
  // back 200 having done nothing, so the caller reported success. Every existing call site
  // passes a nullable token, so all of them were exposed to it.
  let options: ApiClientOptions;

  if (typeof csrfTokenOrOptions === "string" || httpMethod !== undefined) {
    // Signature 2: apiFetch(url, csrfToken, method, body)
    options = {
      method: httpMethod || "GET",
      csrfToken: typeof csrfTokenOrOptions === "string" ? csrfTokenOrOptions : null,
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
  } else {
    // Signature 1: apiFetch(url, options)
    options = (csrfTokenOrOptions as ApiClientOptions | undefined) || {};
  }

  const { csrfToken, headers, ...restOptions } = options;

  // Build headers
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string>),
  };

  // Add CSRF token for state-changing methods
  const httpVerb = (options.method || "GET").toUpperCase();
  const requiresCsrf = ["POST", "PUT", "PATCH", "DELETE"].includes(httpVerb);

  // Fall back to the cookie when no token was threaded in. Callers that already hold one from
  // `useCsrf()` are unaffected; this only rescues call sites with no access to React context
  // (module-level helpers) and removes the need to plumb the token through every component.
  const effectiveCsrfToken = csrfToken || (requiresCsrf ? getCsrfTokenFromDocument() : null);

  if (requiresCsrf && effectiveCsrfToken) {
    requestHeaders["X-CSRF-Token"] = effectiveCsrfToken;
  } else if (requiresCsrf) {
    // Fail fast for state-changing requests without CSRF token
    const error = new Error("CSRF token not available. Please refresh the page and try again.");
    const typedError = error as Error & { status: number };
    typedError.status = 403; // Use 403 Forbidden for CSRF failure
    logger.error("CSRF token missing for state-changing request", {
      url,
      method: httpVerb,
    });
    throw typedError;
  }

  try {
    const response = await fetch(url, {
      ...restOptions,
      method: httpVerb,
      headers: requestHeaders,
      credentials: "include", // Always include cookies
    });

    // Handle HTTP errors
    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: response.statusText,
      }))) as ApiResponse;

      const errorMessage = errorData.error || errorData.message || "API request failed";
      const error = new Error(errorMessage);
      const typedError = error as Error & { status: number; detail?: string; field?: string };
      typedError.status = response.status;
      if ((errorData as ApiResponse & { detail?: string }).detail) {
        typedError.detail = (errorData as ApiResponse & { detail?: string }).detail;
      }
      // `field` was in the envelope and dropped here. `createErrorResponse` puts it there for
      // every `ValidationError`, and it is the one piece of a server error worth showing a
      // user: it turns "check the form" into "the NIF is not valid". `message` stays English
      // and is never displayed — see `lib/utils/api-error.ts`.
      if (errorData.field) {
        typedError.field = errorData.field;
      }

      // For 503 (service unavailable), retry once after a short delay
      if (response.status === 503 && !isRetry) {
        logger.warn("Service unavailable, retrying in 1s", {
          url,
          method: httpVerb,
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return apiFetch<T>(url, csrfTokenOrOptions, httpMethod, body, true);
      }

      throw typedError;
    }

    // Parse response
    const data = (await response.json()) as ApiResponse<T>;

    // Return data field if present, otherwise return entire response
    return (data.data !== undefined ? data.data : data) as T;
  } catch (error) {
    logger.error("API request failed", error instanceof Error ? error : new Error(String(error)), {
      url,
      method: httpVerb,
    });
    throw error;
  }
}

/**
 * Type-safe API client with CSRF protection
 */
export class ApiClient {
  private csrfToken: string | null = null;

  constructor(csrfToken?: string | null) {
    this.csrfToken = csrfToken || null;
  }

  /**
   * Update CSRF token
   */
  setCsrfToken(token: string | null): void {
    this.csrfToken = token;
  }

  /**
   * GET request
   */
  async get<T = unknown>(url: string, options?: RequestInit): Promise<T> {
    return apiFetch<T>(url, {
      ...options,
      method: "GET",
      csrfToken: this.csrfToken,
    });
  }

  /**
   * POST request with CSRF protection
   */
  async post<T = unknown>(url: string, body?: unknown, options?: RequestInit): Promise<T> {
    return apiFetch<T>(url, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
      csrfToken: this.csrfToken,
    });
  }

  /**
   * PUT request with CSRF protection
   */
  async put<T = unknown>(url: string, body?: unknown, options?: RequestInit): Promise<T> {
    return apiFetch<T>(url, {
      ...options,
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
      csrfToken: this.csrfToken,
    });
  }

  /**
   * PATCH request with CSRF protection
   */
  async patch<T = unknown>(url: string, body?: unknown, options?: RequestInit): Promise<T> {
    return apiFetch<T>(url, {
      ...options,
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
      csrfToken: this.csrfToken,
    });
  }

  /**
   * DELETE request with CSRF protection
   */
  async delete<T = unknown>(url: string, options?: RequestInit): Promise<T> {
    return apiFetch<T>(url, {
      ...options,
      method: "DELETE",
      csrfToken: this.csrfToken,
    });
  }
}

/**
 * Create an API client instance with CSRF token
 */
export function createApiClient(csrfToken?: string | null): ApiClient {
  return new ApiClient(csrfToken);
}
