import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ResourceNotFoundError,
  ForbiddenError,
  DatabaseError,
  Logger,
  ConflictError,
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
  parseBody,
  parseJsonBody,
} from "@/lib/utils/error-handling";

// ─── Custom Error Classes ─────────────────────────────────────────────────────

describe("ValidationError", () => {
  it("sets name to ValidationError", () => {
    const err = new ValidationError("bad input");
    expect(err.name).toBe("ValidationError");
    expect(err.message).toBe("bad input");
    expect(err instanceof Error).toBe(true);
  });

  it("stores optional field", () => {
    const err = new ValidationError("required", "email");
    expect(err.field).toBe("email");
  });

  it("field is undefined when not provided", () => {
    const err = new ValidationError("required");
    expect(err.field).toBeUndefined();
  });
});

describe("AuthenticationError", () => {
  it("uses default message", () => {
    const err = new AuthenticationError();
    expect(err.message).toBe("Authentication required");
    expect(err.name).toBe("AuthenticationError");
  });

  it("accepts custom message", () => {
    expect(new AuthenticationError("token expired").message).toBe("token expired");
  });
});

describe("AuthorizationError", () => {
  it("uses default message", () => {
    const err = new AuthorizationError();
    expect(err.message).toBe("Insufficient permissions");
  });

  it("accepts custom message", () => {
    expect(new AuthorizationError("owner only").message).toBe("owner only");
  });
});

describe("ResourceNotFoundError", () => {
  it("formats message with id", () => {
    const err = new ResourceNotFoundError("Tenant", "abc-123");
    expect(err.message).toBe("Tenant with id 'abc-123' not found");
    expect(err.name).toBe("ResourceNotFoundError");
  });

  it("formats message without id", () => {
    const err = new ResourceNotFoundError("Settings");
    expect(err.message).toBe("Settings not found");
  });
});

describe("ForbiddenError", () => {
  it("uses default message", () => {
    expect(new ForbiddenError().message).toBe("Access denied");
  });

  it("accepts custom message", () => {
    expect(new ForbiddenError("read only").message).toBe("read only");
  });
});

describe("DatabaseError", () => {
  it("stores original error", () => {
    const original = new Error("constraint violation");
    const err = new DatabaseError("DB failed", original);
    expect(err.message).toBe("DB failed");
    expect(err.originalError).toBe(original);
    expect(err.name).toBe("DatabaseError");
  });

  it("works without original error", () => {
    const err = new DatabaseError("connection timeout");
    expect(err.originalError).toBeUndefined();
  });
});

// ─── Logger ───────────────────────────────────────────────────────────────────

describe("Logger", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("Logger.error calls console.error with JSON", () => {
    Logger.error("something broke", { id: 1 });
    expect(console.error).toHaveBeenCalledOnce();
    const arg = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const parsed = JSON.parse(arg);
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("something broke");
    expect(parsed.data).toEqual({ id: 1 });
  });

  it("Logger.warn calls console.warn", () => {
    Logger.warn("watch out");
    expect(console.warn).toHaveBeenCalledOnce();
    const parsed = JSON.parse((console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(parsed.level).toBe("warn");
  });

  it("Logger.info calls console.debug", () => {
    Logger.info("hello");
    expect(console.debug).toHaveBeenCalledOnce();
    const parsed = JSON.parse((console.debug as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(parsed.level).toBe("info");
  });

  it("omits data field when not supplied", () => {
    Logger.error("no data");
    const parsed = JSON.parse((console.error as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect("data" in parsed).toBe(false);
  });
});

// ─── createErrorResponse ──────────────────────────────────────────────────────

describe("createErrorResponse", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  async function parseBody(res: Response) {
    return res.json() as Promise<Record<string, unknown>>;
  }

  it("ValidationError → 400 with message", async () => {
    const res = createErrorResponse(new ValidationError("email invalid"));
    expect(res.status).toBe(400);
    const body = await parseBody(res);
    expect(body.error).toBe("email invalid");
  });

  it("ValidationError with field → includes field in response body", async () => {
    const res = createErrorResponse(new ValidationError("required", "phone"));
    const body = await parseBody(res);
    expect(body.field).toBe("phone");
  });

  it("ValidationError without field → no field key in body", async () => {
    const res = createErrorResponse(new ValidationError("bad"));
    const body = await parseBody(res);
    expect("field" in body).toBe(false);
  });

  it("ConflictError → 409, with its reason for the client to say", async () => {
    const res = createErrorResponse(new ConflictError("kept", "tenant_has_history"), 500);
    expect(res.status).toBe(409);
    expect(await parseBody(res)).toEqual({ error: "kept", reason: "tenant_has_history" });
  });

  it("AuthenticationError → 401", async () => {
    const res = createErrorResponse(new AuthenticationError());
    expect(res.status).toBe(401);
  });

  it("AuthorizationError → 403", async () => {
    const res = createErrorResponse(new AuthorizationError());
    expect(res.status).toBe(403);
  });

  it("ResourceNotFoundError → 404", async () => {
    const res = createErrorResponse(new ResourceNotFoundError("Tenant", "1"));
    expect(res.status).toBe(404);
    const body = await parseBody(res);
    expect(body.error).toMatch(/not found/i);
  });

  it("ForbiddenError → 403", async () => {
    expect(createErrorResponse(new ForbiddenError()).status).toBe(403);
  });

  it("DatabaseError → 500 with generic message", async () => {
    const res = createErrorResponse(new DatabaseError("conn timeout"));
    expect(res.status).toBe(500);
    const body = await parseBody(res);
    expect(body.error).toBe("Database operation failed");
  });

  it("generic Error falls back to provided statusCode", async () => {
    const res = createErrorResponse(new Error("boom"), 502);
    expect(res.status).toBe(502);
    const body = await parseBody(res);
    expect(body.error).toBe("Internal server error");
  });

  it("includes Content-Type header", () => {
    const res = createErrorResponse(new ValidationError("x"));
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  // The cases above each pass a single error type with no conflicting status, so none of them
  // pinned what happens when the two disagree. That gap let 17 call sites pass 404 alongside a
  // ValidationError and silently answer 400 — including the tenant portal, where the client
  // branches on `status === 401 || status === 404` to show "this link is invalid or expired"
  // and therefore never showed it.
  it("resolves status from the error TYPE, discarding a conflicting statusCode", async () => {
    const res = createErrorResponse(new ValidationError("Tenant not found"), 404);
    expect(res.status).toBe(400);
    const body = await parseBody(res);
    expect(body.error).toBe("Tenant not found");
  });

  it("keeps a custom message at 404 only via ResourceNotFoundError", async () => {
    // A plain Error honours the status but throws the message away, so it is not a workaround.
    const plain = createErrorResponse(new Error("Tenant not found"), 404);
    expect(plain.status).toBe(404);
    expect((await parseBody(plain)).error).toBe("Internal server error");

    const typed = createErrorResponse(new ResourceNotFoundError("Tenant"), 404);
    expect(typed.status).toBe(404);
    expect((await parseBody(typed)).error).toBe("Tenant not found");
  });
});

// ─── createSuccessResponse ────────────────────────────────────────────────────

describe("createSuccessResponse", () => {
  it("returns 200 by default", async () => {
    const res = createSuccessResponse({ id: "abc" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data).toEqual({ id: "abc" });
  });

  it("respects custom status code", async () => {
    const res = createSuccessResponse([], 201);
    expect(res.status).toBe(201);
  });

  it("includes Content-Type header", () => {
    expect(createSuccessResponse(null).headers.get("Content-Type")).toBe("application/json");
  });
});

// ─── withErrorHandler ─────────────────────────────────────────────────────────

describe("withErrorHandler", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  const makeRequest = () => new NextRequest("http://localhost/api/test");

  it("passes through the handler response on success", async () => {
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const wrapped = withErrorHandler(handler);
    const res = await wrapped(makeRequest());
    expect(res.status).toBe(200);
  });

  it("catches thrown Error and returns 500 response", async () => {
    const handler = vi.fn(async () => {
      throw new Error("unexpected");
    });
    const wrapped = withErrorHandler(handler);
    const res = await wrapped(makeRequest());
    expect(res.status).toBe(500);
  });

  it("catches thrown ValidationError and returns 400", async () => {
    const handler = vi.fn(async () => {
      throw new ValidationError("bad field");
    });
    const wrapped = withErrorHandler(handler);
    const res = await wrapped(makeRequest());
    expect(res.status).toBe(400);
  });

  it("wraps non-Error thrown values in a generic Error", async () => {
    const handler = vi.fn(async () => {
      throw "string error";
    });
    const wrapped = withErrorHandler(handler);
    const res = await wrapped(makeRequest());
    expect(res.status).toBe(500);
  });

  it("forwards context argument to handler", async () => {
    let receivedCtx: unknown;
    const handler = vi.fn(async (_req: NextRequest, ctx?: unknown) => {
      receivedCtx = ctx;
      return new Response("ok");
    });
    const wrapped = withErrorHandler(handler);
    await wrapped(makeRequest(), { params: { id: "42" } });
    expect(receivedCtx).toEqual({ params: { id: "42" } });
  });
});

// ─── parseBody ────────────────────────────────────────────────────────────────

describe("parseBody", () => {
  const schema = z.object({ name: z.string().min(1), age: z.number() });

  it("returns parsed data on valid input", () => {
    expect(parseBody({ name: "Alice", age: 30 }, schema)).toEqual({ name: "Alice", age: 30 });
  });

  it("throws ValidationError on ZodError", () => {
    expect(() => parseBody({ name: "", age: "not a number" }, schema)).toThrow(ValidationError);
  });

  it("ValidationError message contains Zod issue messages", () => {
    try {
      parseBody({}, schema);
    } catch (e) {
      expect((e as ValidationError).message).toMatch(/Validation error/);
    }
  });

  it("re-throws non-Zod errors as-is", () => {
    const badSchema = {
      parse: () => {
        throw new RangeError("not a zod error");
      },
    } as unknown as typeof schema;
    expect(() => parseBody({}, badSchema)).toThrow(RangeError);
  });
});

// ─── parseJsonBody ────────────────────────────────────────────────────────────

describe("parseJsonBody", () => {
  const schema = z.object({ value: z.number() });

  it("parses valid JSON request body", async () => {
    const req = new NextRequest("http://localhost/", {
      method: "POST",
      body: JSON.stringify({ value: 42 }),
      headers: { "Content-Type": "application/json" },
    });
    const result = await parseJsonBody(req, schema);
    expect(result).toEqual({ value: 42 });
  });

  it("throws ValidationError for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/", {
      method: "POST",
      body: JSON.stringify({ value: "not a number" }),
      headers: { "Content-Type": "application/json" },
    });
    await expect(parseJsonBody(req, schema)).rejects.toThrow(ValidationError);
  });
});
