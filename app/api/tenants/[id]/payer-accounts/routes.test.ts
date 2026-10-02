import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The accounts remembered for a tenant: listed for the tenant's Payments tab and forgotten when the
 * owner says so. Both are the owner's only, both are scoped to the caller, and another owner's tenant
 * or account reads exactly as one that does not exist.
 */

const { auth, prismaMock, accounts } = vi.hoisted(() => ({
  auth: { requireOwnerAccess: vi.fn() },
  prismaMock: { tenant: { findFirst: vi.fn() } },
  accounts: { payerAccountsFor: vi.fn(), forgetPayerAccount: vi.fn() },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: auth.requireOwnerAccess,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/bank/payer-accounts", () => accounts);

import { ResourceNotFoundError } from "@/lib/utils/error-handling";
import { GET } from "./route";
import { DELETE } from "./[accountId]/route";

const request = (method: string) =>
  new NextRequest("http://localhost:3000/api/tenants/tenant-1/payer-accounts", { method });
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireOwnerAccess.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
  prismaMock.tenant.findFirst.mockResolvedValue({ id: "tenant-1" });
});

describe("GET /api/tenants/[id]/payer-accounts", () => {
  it("lists the accounts remembered for the caller's tenant", async () => {
    accounts.payerAccountsFor.mockResolvedValue([
      {
        id: "acc-1",
        ibanLast4: "0154",
        holderName: "Ana Costa",
        createdAt: new Date("2026-06-10"),
      },
    ]);

    const res = await GET(request("GET"), ctx({ id: "tenant-1" }));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([
      {
        id: "acc-1",
        ibanLast4: "0154",
        holderName: "Ana Costa",
        createdAt: "2026-06-10T00:00:00.000Z",
      },
    ]);
    expect(prismaMock.tenant.findFirst).toHaveBeenCalledWith({
      where: { id: "tenant-1", userId: "user-1" },
      select: { id: true },
    });
    expect(accounts.payerAccountsFor).toHaveBeenCalledWith("user-1", "tenant-1");
  });

  it("answers 404 for a tenant that is not the caller's, and reads no account", async () => {
    prismaMock.tenant.findFirst.mockResolvedValue(null);

    const res = await GET(request("GET"), ctx({ id: "someone-elses" }));

    expect(res.status).toBe(404);
    expect(accounts.payerAccountsFor).not.toHaveBeenCalled();
  });

  it("answers the refusal and reads nothing for a caller who is not the owner", async () => {
    auth.requireOwnerAccess.mockResolvedValue(new Response(null, { status: 403 }));

    const res = await GET(request("GET"), ctx({ id: "tenant-1" }));

    expect(res.status).toBe(403);
    expect(prismaMock.tenant.findFirst).not.toHaveBeenCalled();
    expect(accounts.payerAccountsFor).not.toHaveBeenCalled();
  });

  it("answers 400 when the address names no tenant", async () => {
    const res = await GET(request("GET"), ctx({}));

    expect(res.status).toBe(400);
    expect(prismaMock.tenant.findFirst).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/tenants/[id]/payer-accounts/[accountId]", () => {
  it("forgets the account, for the caller and the tenant named", async () => {
    accounts.forgetPayerAccount.mockResolvedValue(undefined);

    const res = await DELETE(request("DELETE"), ctx({ id: "tenant-1", accountId: "acc-1" }));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ forgotten: true });
    expect(accounts.forgetPayerAccount).toHaveBeenCalledWith("user-1", "tenant-1", "acc-1");
  });

  it("answers 404 for an account that is not there, or is not the caller's", async () => {
    accounts.forgetPayerAccount.mockRejectedValue(new ResourceNotFoundError("Payer account"));

    const res = await DELETE(request("DELETE"), ctx({ id: "tenant-1", accountId: "acc-9" }));

    expect(res.status).toBe(404);
  });

  it("answers the refusal and forgets nothing for a caller who is not the owner", async () => {
    auth.requireOwnerAccess.mockResolvedValue(new Response(null, { status: 403 }));

    const res = await DELETE(request("DELETE"), ctx({ id: "tenant-1", accountId: "acc-1" }));

    expect(res.status).toBe(403);
    expect(accounts.forgetPayerAccount).not.toHaveBeenCalled();
  });

  it("answers 400 when the address names no account", async () => {
    const res = await DELETE(request("DELETE"), ctx({ id: "tenant-1" }));

    expect(res.status).toBe(400);
    expect(accounts.forgetPayerAccount).not.toHaveBeenCalled();
  });
});
