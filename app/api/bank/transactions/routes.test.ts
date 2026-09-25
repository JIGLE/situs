import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The inbox's routes: what the list and the counts read, and that an action's refusal reaches
 * the screen as itself. The action service is tested in lib/services/bank/transaction-action.test.ts.
 */

const { prismaMock, access, actionMock } = vi.hoisted(() => ({
  prismaMock: {
    bankTransaction: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
    lease: { findMany: vi.fn() },
  },
  access: vi.fn(),
  actionMock: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: access,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/bank/import", () => ({ applyTransactionAction: actionMock }));

import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";
import { GET as list } from "./route";
import { GET as summary } from "./summary/route";
import { PUT as act } from "./[id]/route";

const request = (path: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost:3000/api/bank/transactions${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
  prismaMock.bankTransaction.findMany.mockResolvedValue([]);
  prismaMock.lease.findMany.mockResolvedValue([]);
});

describe("GET /api/bank/transactions", () => {
  it("reads money in only, for the review filter", async () => {
    await list(request("?status=needs_review&direction=in"));

    expect(prismaMock.bankTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", status: "needs_review", amount: { gt: 0 } },
      }),
    );
  });

  it("reads money out, reversals included, for the outgoing filter", async () => {
    await list(request("?status=needs_review&direction=out"));

    expect(prismaMock.bankTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", status: "needs_review", amount: { lte: 0 } },
      }),
    );
  });

  it("reads both directions when none is named", async () => {
    await list(request("?status=ignored"));

    expect(prismaMock.bankTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", status: "ignored" } }),
    );
  });
});

describe("GET /api/bank/transactions/summary", () => {
  it("counts money in to review apart from money out", async () => {
    prismaMock.bankTransaction.groupBy.mockResolvedValue([
      { status: "needs_review", _count: { _all: 7 } },
      { status: "auto_matched", _count: { _all: 3 } },
      { status: "matched_confirmed", _count: { _all: 10 } },
      { status: "ignored", _count: { _all: 2 } },
    ]);
    prismaMock.bankTransaction.count.mockResolvedValue(5);

    const res = await summary(request("/summary"));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      toReview: 2,
      outgoing: 5,
      autoMatched: 3,
      confirmed: 10,
      ignored: 2,
      all: 22,
    });
    expect(prismaMock.bankTransaction.count).toHaveBeenCalledWith({
      where: { userId: "user-1", status: "needs_review", amount: { lte: 0 } },
    });
  });

  it("reads nothing for a caller the owner check turns away", async () => {
    access.mockResolvedValue(new Response(null, { status: 403 }));

    expect((await summary(request("/summary"))).status).toBe(403);
    expect(prismaMock.bankTransaction.groupBy).not.toHaveBeenCalled();
  });
});

describe("PUT /api/bank/transactions/[id]", () => {
  it("takes an ignored movement back to review", async () => {
    actionMock.mockResolvedValue({ status: "needs_review", receiptId: null });

    const res = await act(request("/txn-1", "PUT", { action: "restore" }), withId("txn-1"));

    expect(res.status).toBe(200);
    expect(actionMock).toHaveBeenCalledWith("user-1", "txn-1", "restore", undefined);
  });

  it("answers a refusal as a 409 with its reason", async () => {
    actionMock.mockRejectedValue(
      new ConflictError("Outflows cannot be allocated as rent", "bank_outflow_not_rent"),
    );

    const res = await act(request("/txn-1", "PUT", { action: "confirm" }), withId("txn-1"));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "bank_outflow_not_rent" });
  });

  it("answers a movement it cannot find as a 404", async () => {
    actionMock.mockRejectedValue(new ResourceNotFoundError("Bank movement"));

    const res = await act(request("/txn-9", "PUT", { action: "ignore" }), withId("txn-9"));

    expect(res.status).toBe(404);
  });

  it("answers an unexpected failure as a server error, not as a bad request", async () => {
    actionMock.mockRejectedValue(new Error("database is locked"));

    const res = await act(request("/txn-1", "PUT", { action: "ignore" }), withId("txn-1"));

    expect(res.status).toBe(500);
  });

  it("refuses an action it does not know with a 400", async () => {
    const res = await act(request("/txn-1", "PUT", { action: "delete" }), withId("txn-1"));

    expect(res.status).toBe(400);
    expect(actionMock).not.toHaveBeenCalled();
  });
});
