import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `POST /api/email/metrics` resends a failed email, and `GET` counts delivery. Both used to read
 * every account's mail: the service looked a log up by its id alone and added every account's
 * counts together, and the route proved a session existed, never whose.
 *
 * What is whose is the service's to enforce (`email-service.scoping.test.ts` asserts it against a
 * store that answers a `where` as Prisma does). This asserts what the route hands it, and what it
 * answers.
 */

const { requireAuth, emailService } = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  emailService: {
    getEmailMetrics: vi.fn(),
    getRecentEmails: vi.fn(),
    retryFailedEmail: vi.fn(),
    isReady: vi.fn(() => true),
  },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({ requireAuth }));
vi.mock("@/lib/services/email/email-service", () => ({ emailService }));

import { GET, POST } from "./route";

const URL_ = "http://localhost:3000/api/email/metrics";

function post(body: string) {
  return new NextRequest(URL_, {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireAuth.mockResolvedValue({ userId: "user-1" });
});

describe("GET /api/email/metrics", () => {
  it("reads the signed-in account's own metrics and recent mail", async () => {
    emailService.getEmailMetrics.mockResolvedValue({ totalSent: 2, periodDays: 7 });
    emailService.getRecentEmails.mockResolvedValue([]);

    const res = await GET(new NextRequest(`${URL_}?days=7`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { metrics: { totalSent: 2, periodDays: 7 }, recentEmails: [], isConfigured: true },
    });
    expect(emailService.getEmailMetrics).toHaveBeenCalledWith("user-1", 7);
    expect(emailService.getRecentEmails).toHaveBeenCalledWith("user-1", 10);
  });

  it("answers a missing session as the session check does, and reads nothing", async () => {
    requireAuth.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await GET(new NextRequest(URL_));

    expect(res.status).toBe(401);
    expect(emailService.getEmailMetrics).not.toHaveBeenCalled();
  });
});

describe("POST /api/email/metrics", () => {
  it("retries the log for the signed-in account", async () => {
    emailService.retryFailedEmail.mockResolvedValue({ success: true });

    const res = await POST(post(JSON.stringify({ emailLogId: "log-1" })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { message: "Email retry initiated successfully" } });
    expect(emailService.retryFailedEmail).toHaveBeenCalledWith("log-1", "user-1");
  });

  it("answers a log that is not the caller's as 404, as it answers one that is not there", async () => {
    emailService.retryFailedEmail.mockResolvedValue({
      success: false,
      error: "Email log not found",
      notFound: true,
    });

    const res = await POST(post(JSON.stringify({ emailLogId: "log-of-someone-else" })));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Email log not found" });
  });

  it("answers an email that cannot be retried as 400", async () => {
    emailService.retryFailedEmail.mockResolvedValue({
      success: false,
      error: "Only failed emails can be retried",
    });

    const res = await POST(post(JSON.stringify({ emailLogId: "log-1" })));

    expect(res.status).toBe(400);
  });

  it.each([
    ["no id", "{}"],
    ["an empty id", JSON.stringify({ emailLogId: "" })],
    ["a number", JSON.stringify({ emailLogId: 42 })],
    // `findFirst` reads an object as a filter, so this would pick one of the caller's logs.
    ["a filter object", JSON.stringify({ emailLogId: { startsWith: "" } })],
    ["a body of null", "null"],
    ["an array", "[]"],
    ["a string", JSON.stringify("log-1")],
    ["a body that is not JSON", "{emailLogId: log-1"],
  ])("answers %s as 400 and retries nothing", async (_name, body) => {
    const res = await POST(post(body));

    expect(res.status).toBe(400);
    expect(emailService.retryFailedEmail).not.toHaveBeenCalled();
  });

  it("answers a missing session as the session check does, and retries nothing", async () => {
    requireAuth.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await POST(post(JSON.stringify({ emailLogId: "log-1" })));

    expect(res.status).toBe(401);
    expect(emailService.retryFailedEmail).not.toHaveBeenCalled();
  });
});
