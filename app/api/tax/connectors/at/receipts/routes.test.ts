import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The receipts-at-AT routes: what they accept, whose receipts they read, and that a refusal
 * reaches the screen with its reason. The service is tested in lib/services/tax/at-receipts.test.ts.
 */

const { service, access } = vi.hoisted(() => ({
  service: { previewAtReceipts: vi.fn(), testAtReceipts: vi.fn() },
  access: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: access,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/tax/at-receipts", () => service);

import { ConflictError } from "@/lib/utils/error-handling";
import { POST as postPreview } from "./preview/route";
import { POST as postTest } from "./test/route";

const request = (path: string, body: unknown) =>
  new NextRequest(`http://localhost:3000/api/tax/connectors/at/receipts/${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const ids = (count: number) => Array.from({ length: count }, (_, index) => `rcpt-${index}`);

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ userId: "manager-1", scopeUserId: "owner-1" });
  service.previewAtReceipts.mockResolvedValue({ mode: "review", canTest: false, receipts: [] });
  service.testAtReceipts.mockResolvedValue([]);
});

describe("POST /api/tax/connectors/at/receipts/preview", () => {
  it("reviews the receipts in the owner's own records", async () => {
    const res = await postPreview(request("preview", { receiptIds: ["rcpt-1", "rcpt-2"] }));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ mode: "review", canTest: false, receipts: [] });
    expect(service.previewAtReceipts).toHaveBeenCalledWith("owner-1", ["rcpt-1", "rcpt-2"]);
  });

  it("answers a body that is not JSON, no receipts, or too many as a 400", async () => {
    for (const body of [
      "not json",
      {},
      { receiptIds: [] },
      { receiptIds: ids(101) },
      { receiptIds: [""] },
    ]) {
      expect((await postPreview(request("preview", body))).status).toBe(400);
    }
    expect(service.previewAtReceipts).not.toHaveBeenCalled();
  });

  it("reads nothing for a caller the owner check turns away", async () => {
    access.mockResolvedValue(new Response(null, { status: 403 }));

    expect((await postPreview(request("preview", { receiptIds: ["rcpt-1"] }))).status).toBe(403);
    expect(service.previewAtReceipts).not.toHaveBeenCalled();
  });
});

describe("POST /api/tax/connectors/at/receipts/test", () => {
  it("sends the owner's receipts to AT's test service and answers with what AT said", async () => {
    service.testAtReceipts.mockResolvedValue([{ receiptId: "rcpt-1", refusal: null, months: [] }]);

    const res = await postTest(request("test", { receiptIds: ["rcpt-1"] }));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      receipts: [{ receiptId: "rcpt-1", refusal: null, months: [] }],
    });
    expect(service.testAtReceipts).toHaveBeenCalledWith("owner-1", ["rcpt-1"]);
  });

  it("takes at most twelve receipts, and answers anything else malformed as a 400", async () => {
    for (const body of ["not json", { receiptIds: ids(13) }, { receiptIds: "rcpt-1" }]) {
      expect((await postTest(request("test", body))).status).toBe(400);
    }
    expect(service.testAtReceipts).not.toHaveBeenCalled();
  });

  it("passes on a refusal with its reason, such as the test mode not being on", async () => {
    service.testAtReceipts.mockRejectedValue(
      new ConflictError("The connector is not in the test mode", "at_test_mode_required"),
    );

    const res = await postTest(request("test", { receiptIds: ["rcpt-1"] }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "at_test_mode_required" });
  });

  it("sends nothing for a caller the owner check turns away", async () => {
    access.mockResolvedValue(new Response(null, { status: 403 }));

    expect((await postTest(request("test", { receiptIds: ["rcpt-1"] }))).status).toBe(403);
    expect(service.testAtReceipts).not.toHaveBeenCalled();
  });
});
