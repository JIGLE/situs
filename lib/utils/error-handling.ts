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
  } else if (error instanceof DatabaseError) {
    message = "Database operation failed";
    status = 500;
  }

  return new NextResponse(
    JSON.stringify({
      error: message,
      ...(error instanceof ValidationError && error.field && { field: error.field }),
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
 * Validate an already-parsed body object against a Zod schema.
 *
 * Throws `ValidationError` (→ 400) on failure, so callers wrapped in
 * `withErrorHandler` need no additional try/catch for ZodError.
 *
 * Use this when you need to sanitize the raw body before validation.
 *
 * @example
 * const raw = await request.json();
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
  return parseBody(await request.json(), schema);
}
