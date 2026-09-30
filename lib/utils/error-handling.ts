import { NextRequest, NextResponse } from "next/server";
import { ZodError, ZodSchema } from "zod";

// Custom error types
export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends Error {
  constructor(message: string = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message: string = "Insufficient permissions") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class ResourceNotFoundError extends Error {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} with id '${id}' not found` : `${resource} not found`);
    this.name = "ResourceNotFoundError";
  }
}

export class ForbiddenError extends Error {
  constructor(message: string = "Access denied") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * The request is valid, but what the record holds forbids it: 409.
 *
 * `reason` names the rule, and goes to the client in the envelope. `useApiError`
 * (`lib/utils/api-error.ts`) turns the reasons it knows into a sentence in the user's language;
 * the English `message` is a log, as every other error message here is.
 */
export class ConflictError extends Error {
  constructor(
    message: string,
    public reason: string,
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

export class DatabaseError extends Error {
  constructor(
    message: string,
    public originalError?: unknown,
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

// Logger utility
export class Logger {
  static log(level: "info" | "warn" | "error", message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const logEntry: Record<string, unknown> = {
      timestamp,
      level,
      message,
    };
    if (data !== undefined) logEntry.data = data;

    // In production, you might want to use a proper logging service
    if (level === "error") {
      console.error(JSON.stringify(logEntry));
    } else if (level === "warn") {
      console.warn(JSON.stringify(logEntry));
    } else {
      // Use debug for informational logs to reduce noise during tests
      console.debug(JSON.stringify(logEntry));
    }
  }

  static info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }

  static warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }

  static error(message: string, data?: unknown): void {
    this.log("error", message, data);
  }
}

// Error response utility
export function createErrorResponse(
  error: Error,
  statusCode: number = 500,
  request?: NextRequest,
): NextResponse {
  // Log the error
  Logger.error("API Error", {
    error: error.message,
    stack: error.stack,
    url: request?.url,
    method: request?.method,
    userAgent: request?.headers.get("user-agent"),
  });

  // Determine error response based on error type
  let message = "Internal server error";
  let status = statusCode;

  if (error instanceof ValidationError) {
    message = error.message;
    status = 400;
  } else if (error instanceof AuthenticationError) {
    message = error.message;
    status = 401;
  } else if (error instanceof AuthorizationError) {
    message = error.message;
    status = 403;
  } else if (error instanceof ResourceNotFoundError) {
    message = error.message;
    status = 404;
  } else if (error instanceof ForbiddenError) {
    message = error.message;
    status = 403;
  } else if (error instanceof ConflictError) {
    message = error.message;
    status = 409;
  } else if (error instanceof DatabaseError) {
    message = "Database operation failed";
    status = 500;
  }

  return new NextResponse(
    JSON.stringify({
      error: message,
      ...(error instanceof ValidationError && error.field && { field: error.field }),
      ...(error instanceof ConflictError && { reason: error.reason }),
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

// Success response utility
export function createSuccessResponse(data: unknown, statusCode: number = 200): NextResponse {
  return new NextResponse(JSON.stringify({ data }), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

// Async error wrapper for API routes (generic to allow typed context)
export function withErrorHandler<C = unknown>(
  handler: (request: NextRequest, context?: C) => Promise<Response | NextResponse>,
): (request: NextRequest, context?: C) => Promise<Response | NextResponse> {
  return async (request: NextRequest, context?: C): Promise<Response | NextResponse> => {
    try {
      return await handler(request, context);
    } catch (error: unknown) {
      // If it's an Error, use it, otherwise wrap in a generic Error
      const err = error instanceof Error ? error : new Error(JSON.stringify(error));
      return createErrorResponse(err, 500, request);
    }
  };
}

/**
 * A JSON body nobody has validated yet. A few older handlers read its fields one at a time and
 * sanitise each before a schema sees the result, so it is typed as loosely as `request.json()`
 * was. A new handler validates first (`parseBody`, `parseJsonBody`) and has no use for it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawBody = Record<string, any>;

// By name, so it holds whichever realm built the error.
const isSyntaxError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === "SyntaxError";

/**
 * The JSON body of a request, or a `ValidationError` (→ 400) when the body is not JSON.
 *
 * `request.json()` alone rejects a body that is empty or malformed with a `SyntaxError`, and
 * `withErrorHandler` answers any error it does not know as a 500: a server error for what is the
 * caller's mistake. `app/api/json-body-status.test.ts` refuses a bare `request.json()` in a route.
 *
 * Only a `SyntaxError` becomes a `ValidationError`. Anything else `json()` throws, such as a body
 * that was already read, is a bug in this server and stays one.
 *
 * A handler that answers its own errors instead of going through `withErrorHandler` has to catch
 * the `ValidationError` itself; `app/api/json-body-answers-400.test.ts` covers the ones that do.
 *
 * @example
 * const raw = await readJson(request);
 */
export async function readJson(request: Pick<Request, "json">): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (isSyntaxError(error)) {
      throw new ValidationError("Invalid request: the body is not JSON");
    }
    throw error;
  }
}

/**
 * Validate an already-parsed body object against a Zod schema.
 *
 * Throws `ValidationError` (→ 400) on failure, so callers wrapped in
 * `withErrorHandler` need no additional try/catch for ZodError.
 *
 * Use this when you need to sanitize the raw body before validation.
 *
 * @example
 * const raw = (await readJson(request)) as RawBody;
 * const data = parseBody({ ...raw, name: sanitizeForDatabase(raw.name) }, schema);
 */
export function parseBody<T>(body: unknown, schema: ZodSchema<T>): T {
  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError(
        `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      );
    }
    throw error;
  }
}

/**
 * Parse and validate a JSON request body against a Zod schema.
 *
 * Throws `ValidationError` (→ 400) when validation fails, so callers wrapped in
 * `withErrorHandler` need no additional try/catch for ZodError.
 *
 * Use this for routes that do not need sanitization before validation.
 *
 * @example
 * const data = await parseJsonBody(request, createTenantSchema);
 */
export async function parseJsonBody<T>(request: NextRequest, schema: ZodSchema<T>): Promise<T> {
  return parseBody(await readJson(request), schema);
}
