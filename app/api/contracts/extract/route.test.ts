// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { sampleExtraction } from "@/tests/fixtures/contract-extraction";

/**
 * Reading a contract: the one route that sends a document outside the instance. Pinned here: who
 * may call it, that nothing is sent when no reader is configured or the file is not a PDF, that
 * every reading is audited whatever its outcome, and that a failure comes back as a reason the
 * sheet can translate.
 */

const { access, limiter, reader, prismaMock, audit } = vi.hoisted(() => ({
  access: vi.fn(),
  limiter: vi.fn(),
  reader: { configured: true, extract: vi.fn() },
  prismaMock: {
    property: { findMany: vi.fn() },
    owner: { findMany: vi.fn() },
    tenant: { findMany: vi.fn() },
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({ requireOwnerAccess: access }));
vi.mock("@/lib/middleware/rate-limit", () => ({ rateLimit: limiter }));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: audit }));
vi.mock("@/lib/utils/contract-file", () => ({ MAX_CONTRACT_BYTES: 64, MAX_PROOF_BYTES: 32 }));
vi.mock("@/lib/services/contracts/extractor", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/services/contracts/extractor")>()),
  contractReaderConfigured: () => reader.configured,
  getContractExtractor: async () =>
    reader.configured ? { model: "claude-opus-5", extract: reader.extract } : null,
}));

import { GET, POST } from "./route";
import { ContractReadError } from "@/lib/services/contracts/extractor";

const PDF = "%PDF-1.7 contract";

function extractRequest(files: Record<string, string>, language = "pt") {
  const form = new FormData();
  for (const [field, content] of Object.entries(files)) {
    form.append(field, new Blob([content], { type: "application/pdf" }), `${field}.pdf`);
  }
  form.append("language", language);
  return new NextRequest("http://localhost/api/contracts/extract", { method: "POST", body: form });
}

describe("/api/contracts/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reader.configured = true;
    access.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
    limiter.mockResolvedValue(null);
    reader.extract.mockResolvedValue(sampleExtraction);
    prismaMock.property.findMany.mockResolvedValue([]);
    prismaMock.owner.findMany.mockResolvedValue([]);
    prismaMock.tenant.findMany.mockResolvedValue([
      { id: "tenant-ana", email: "ana.costa@example.pt", taxId: null, taxCountry: "PT" },
    ]);
  });

  it("tells the Leases screen whether a reader is configured", async () => {
    reader.configured = false;
    const res = await GET(new NextRequest("http://localhost/api/contracts/extract"));
    expect(await res.json()).toEqual({ data: { configured: false } });
  });

  it("checks the session before anything else", async () => {
    access.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await POST(extractRequest({ contract: PDF }));

    expect(res.status).toBe(401);
    expect(limiter).not.toHaveBeenCalled();
    expect(reader.extract).not.toHaveBeenCalled();
  });

  it("sends nothing when no reader is configured", async () => {
    reader.configured = false;

    const res = await POST(extractRequest({ contract: PDF }));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "not_configured" });
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses a file that is not a PDF, or too large, before sending it", async () => {
    const notPdf = await POST(extractRequest({ contract: "<html>" }));
    expect(notPdf.status).toBe(415);
    expect(await notPdf.json()).toMatchObject({ reason: "not_pdf" });

    const tooLarge = await POST(extractRequest({ contract: `${PDF}${"x".repeat(64)}` }));
    expect(tooLarge.status).toBe(413);
    expect(reader.extract).not.toHaveBeenCalled();
  });

  it("stops at the per-owner rate limit", async () => {
    limiter.mockResolvedValue(NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }));

    const res = await POST(extractRequest({ contract: PDF }));

    expect(res.status).toBe(429);
    expect(limiter.mock.calls[0][1].identifier()).toBe("contract-extract:user-1");
    expect(reader.extract).not.toHaveBeenCalled();
  });

  it("returns the reading and the owner's records it matches, and audits the transfer", async () => {
    const res = await POST(extractRequest({ contract: PDF, registration: "%PDF-1.7 proof" }, "es"));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.reading).toEqual(sampleExtraction);
    expect(data.matches.tenants[0]).toEqual({ id: "tenant-ana", by: "email" });
    const [documents, language] = reader.extract.mock.calls[0];
    expect(documents.map((d: { kind: string }) => d.kind)).toEqual(["contract", "registration"]);
    expect(language).toBe("es");
    // Scoped to the caller: the matches can only be the caller's own records.
    expect(prismaMock.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "EXTRACT_LEASE_CONTRACT",
        details: expect.objectContaining({ model: "claude-opus-5", documents: 2, outcome: "read" }),
      }),
    );
  });

  it("says why a reading failed, and still audits it: the documents left either way", async () => {
    reader.extract.mockRejectedValue(new ContractReadError("refused", "declined"));

    const res = await POST(extractRequest({ contract: PDF }));

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "refused" });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ outcome: "refused" }) }),
    );
  });
});
