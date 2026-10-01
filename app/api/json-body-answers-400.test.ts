import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The routes that answer their own errors, instead of through `withErrorHandler`, each have to turn
 * `readJson`'s `ValidationError` into a 400 themselves. `json-body-status.test.ts` checks that no
 * route reads a body bare; this checks these eight answer what they should when one is not JSON.
 *
 * Every other route hands the error to `withErrorHandler`, or to a `catch` that ends in
 * `createErrorResponse`, and both resolve the status from the error's type.
 */

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1" })),
}));
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
vi.mock("@/lib/services/auth/auth", () => ({ getAuthOptions: () => ({}) }));
vi.mock("@/lib/middleware/rate-limit", () => ({
  RateLimits: { AUTH: {} },
  rateLimit: vi.fn(async () => null),
}));
vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => ({
    lease: {
      findFirst: vi.fn(async () => ({
        id: "lease-1",
        status: "active",
        renewalStatus: "offered",
        endDate: new Date("2027-01-01"),
        monthlyRent: 800,
      })),
    },
  }),
}));
vi.mock("@/lib/services/income-distribution", () => ({
  calculateDistribution: vi.fn(),
  saveDistribution: vi.fn(),
  getDistributionHistory: vi.fn(),
}));
vi.mock("@/lib/services/pdf-generator", () => ({
  documentExport: { generateLeasePDF: vi.fn() },
}));

import { POST as totpEnable } from "./auth/totp/enable/route";
import { POST as totpVerify } from "./auth/totp/verify/route";
import { POST as createNotification } from "./notifications/route";
import { PUT as updateNotification } from "./notifications/[id]/route";
import { POST as createDistribution } from "./distributions/route";
import { POST as generateTemplate } from "./leases/generate-template/route";
import { POST as offerRenewal, PATCH as answerRenewal } from "./leases/[id]/renewal/route";

const notJson = (method: string) =>
  new NextRequest("http://localhost:3000/api/x", { method, body: "{code: 123456" });
const jsonNull = (method: string) =>
  new NextRequest("http://localhost:3000/api/x", { method, body: "null" });
const context = { params: Promise.resolve({ id: "lease-1" }) };

const cases: [string, () => Promise<Response>][] = [
  ["POST /api/auth/totp/enable", () => totpEnable(notJson("POST"))],
  ["POST /api/auth/totp/verify", () => totpVerify(notJson("POST"))],
  ["POST /api/notifications", () => createNotification(notJson("POST"))],
  ["PUT /api/notifications/[id]", () => updateNotification(notJson("PUT"), context)],
  ["POST /api/distributions", () => createDistribution(notJson("POST"))],
  ["POST /api/leases/generate-template", () => generateTemplate(notJson("POST"))],
  ["POST /api/leases/[id]/renewal", () => offerRenewal(notJson("POST"), context)],
  ["PATCH /api/leases/[id]/renewal", () => answerRenewal(notJson("PATCH"), context)],
];

// JSON that is not an object. The first four read fields off the body before any schema, so they
// say it is not an object; the others hand `null` to their schema, which refuses it in its own words.
const nullCases: [string, () => Promise<Response>, string | undefined][] = [
  ["PUT /api/notifications/[id]", () => updateNotification(jsonNull("PUT"), context), "object"],
  ["POST /api/distributions", () => createDistribution(jsonNull("POST")), "object"],
  ["POST /api/leases/[id]/renewal", () => offerRenewal(jsonNull("POST"), context), "object"],
  ["PATCH /api/leases/[id]/renewal", () => answerRenewal(jsonNull("PATCH"), context), "object"],
  ["POST /api/auth/totp/enable", () => totpEnable(jsonNull("POST")), undefined],
  ["POST /api/auth/totp/verify", () => totpVerify(jsonNull("POST")), undefined],
  ["POST /api/notifications", () => createNotification(jsonNull("POST")), undefined],
  ["POST /api/leases/generate-template", () => generateTemplate(jsonNull("POST")), undefined],
];

describe("routes that answer their own errors", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

  it.each(cases)("%s answers a body that is not JSON as a 400, not a 500", async (_name, call) => {
    const res = await call();

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request: the body is not JSON" });
  });

  it.each(nullCases)(
    "%s answers a JSON null body as a 400, not a 500",
    async (_name, call, says) => {
      const res = await call();

      expect(res.status).toBe(400);
      if (says) expect((await res.json()).error).toContain(says);
    },
  );
});
