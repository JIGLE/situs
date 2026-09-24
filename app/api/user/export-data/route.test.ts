import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encryptPII } from "@/lib/utils/pii-encryption";

/**
 * The export is the owner's Article 15 copy of their data, so what it holds has to be readable.
 * It reads every relation nested under the user, and the PII extension decrypts only the
 * top-level model a query names: each NIF and phone number reached the file as `enc:…`.
 */

const { requireAuthMock, findUniqueMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => ({ user: { findUnique: findUniqueMock } }),
}));
vi.mock("@/lib/services/audit-log", () => ({
  logAudit: vi.fn(),
  getAuditLogsForUser: vi.fn().mockResolvedValue([]),
}));
import { POST } from "./route";

const exportRequest = () =>
  new NextRequest("http://localhost:3000/api/user/export-data", { method: "POST" });

describe("POST /api/user/export-data", () => {
  beforeEach(() => {
    vi.stubEnv("PII_ENCRYPTION_KEY", "d".repeat(64));
    requireAuthMock.mockResolvedValue({ session: { user: { id: "user-1" } } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("hands over the NIFs and phone numbers it holds in clear, not as ciphertext", async () => {
    // What the Prisma client returns for an include: the nested rows as stored.
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      email: "owner@example.pt",
      tenants: [
        {
          id: "tenant-1",
          name: "Ana Costa",
          phone: encryptPII("+351 912 345 678"),
          taxId: encryptPII("123456789"),
        },
      ],
      owners: [{ id: "owner-1", taxIdentificationNumber: encryptPII("234567899") }],
      leaseParties: [{ id: "party-1", name: "Hans Weber", idDocument: encryptPII("C01X00T47") }],
    });

    const res = await POST(exportRequest());
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).not.toContain("enc:");
    const exported = JSON.parse(body);
    expect(exported.tenants[0]).toMatchObject({ phone: "+351 912 345 678", taxId: "123456789" });
    expect(exported.owners[0].taxIdentificationNumber).toBe("234567899");
    expect(exported.leaseParties[0].idDocument).toBe("C01X00T47");
  });
});
