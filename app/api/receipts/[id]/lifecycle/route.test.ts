import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `PUT /api/receipts/[id]/lifecycle` answers each refusal with its own status: another owner's
 * receipt is a 404, a refused move a 409 with the rule that refused it. It used to catch
 * everything as a 400, so the screen could only say "invalid request" — and an unexpected failure
 * read as the caller's mistake.
 */

const { transitionReceipt } = vi.hoisted(() => ({ transitionReceipt: vi.fn() }));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: vi.fn(async () => ({ userId: "user-1", scopeUserId: "user-1" })),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/receipts/service", () => ({ transitionReceipt }));

import { PUT } from "./route";
import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";

const put = (body: unknown) =>
  PUT(
    new NextRequest("http://localhost:3000/api/receipts/rec-1/lifecycle", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: "rec-1" }) },
  );

describe("PUT /api/receipts/[id]/lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves the caller's receipt", async () => {
    transitionReceipt.mockResolvedValue({ lifecycle: "emitted", archived: true });

    const res = await put({ to: "emitted" });

    expect(res.status).toBe(200);
    expect(transitionReceipt).toHaveBeenCalledWith("user-1", "rec-1", "emitted", {
      voidReason: undefined,
    });
    expect((await res.json()).data.lifecycle).toBe("emitted");
  });

  it("answers 400 for a stage that does not exist, and moves nothing", async () => {
    const res = await put({ to: "published" });

    expect(res.status).toBe(400);
    expect(transitionReceipt).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not JSON, and moves nothing", async () => {
    const res = await PUT(
      new NextRequest("http://localhost:3000/api/receipts/rec-1/lifecycle", {
        method: "PUT",
        body: "{to: emitted",
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "rec-1" }) },
    );

    expect(res.status).toBe(400);
    expect(transitionReceipt).not.toHaveBeenCalled();
  });

  it("answers 404 for a receipt that is not the caller's", async () => {
    transitionReceipt.mockRejectedValue(new ResourceNotFoundError("Receipt"));

    expect((await put({ to: "emitted" })).status).toBe(404);
  });

  it("answers 409 with the rule that refused the move", async () => {
    transitionReceipt.mockRejectedValue(
      new ConflictError('Cannot move from "voided" to "emitted"', "receipt_transition_not_allowed"),
    );

    const res = await put({ to: "emitted" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "receipt_transition_not_allowed" });
  });

  it("answers an unexpected failure as a server error, not a bad request", async () => {
    transitionReceipt.mockRejectedValue(new Error("disk full"));

    expect((await put({ to: "emitted" })).status).toBe(500);
  });
});
