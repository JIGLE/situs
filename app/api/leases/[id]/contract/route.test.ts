import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decryptFile, encryptFile, isEncryptedFile } from "@/lib/utils/pii-encryption";

/**
 * A lease's contract PDF, on its own route. It used to travel inside the lease JSON: uploaded as
 * an array of numbers, and listed back with every lease, where the browser turned it into an
 * empty download. It is stored encrypted, since it carries the NIFs the database encrypts
 * elsewhere.
 */

const { prismaMock, logAudit } = vi.hoisted(() => ({
  prismaMock: { lease: { findFirst: vi.fn(), update: vi.fn() } },
  logAudit: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: vi.fn(async () => ({ userId: "user-1", scopeUserId: "user-1" })),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit }));

import { DELETE, GET, PUT } from "./route";
import { MAX_CONTRACT_BYTES, contractFileName } from "@/lib/utils/contract-file";

const KEY = "c".repeat(64);
const pdf = Buffer.from("%PDF-1.7\nContrato de arrendamento, NIF 123456789\n%%EOF");
const params = { params: Promise.resolve({ id: "lease-1" }) };
const url = "http://localhost:3000/api/leases/lease-1/contract";

const upload = (body: Uint8Array, headers: Record<string, string> = {}) =>
  PUT(
    new NextRequest(url, {
      method: "PUT",
      body: new Uint8Array(body),
      headers: { "Content-Type": "application/pdf", ...headers },
    }),
    params,
  );

const written = () => prismaMock.lease.update.mock.calls[0][0].data;

describe("/api/leases/[id]/contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PII_ENCRYPTION_KEY = KEY;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    prismaMock.lease.findFirst.mockResolvedValue({ id: "lease-1" });
  });

  afterEach(() => {
    delete process.env.PII_ENCRYPTION_KEY;
    vi.restoreAllMocks();
  });

  describe("PUT", () => {
    it("stores the PDF encrypted, with its name and size", async () => {
      const res = await upload(pdf, {
        "X-File-Name": encodeURIComponent("Contrato Rua Augusta.pdf"),
      });

      expect(res.status).toBe(200);
      const data = written();
      expect(isEncryptedFile(data.contractFile)).toBe(true);
      expect(Buffer.from(data.contractFile).includes(Buffer.from("123456789"))).toBe(false);
      expect(decryptFile(data.contractFile)?.equals(pdf)).toBe(true);
      expect(data.contractFileName).toBe("Contrato Rua Augusta.pdf");
      expect(data.contractFileSize).toBe(pdf.length);
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "UPLOAD_LEASE_CONTRACT", resourceId: "lease-1" }),
      );
    });

    // Judged by the file's first bytes: the Content-Type is whatever the client chose to send.
    it("refuses a file that is not a PDF, whatever its Content-Type says", async () => {
      const res = await upload(Buffer.from("<html>not a contract</html>"));

      expect(res.status).toBe(415);
      expect(prismaMock.lease.update).not.toHaveBeenCalled();
    });

    it("refuses a file declared larger than the limit before reading it", async () => {
      const res = await upload(pdf, { "Content-Length": String(MAX_CONTRACT_BYTES + 1) });

      expect(res.status).toBe(413);
      expect(prismaMock.lease.findFirst).not.toHaveBeenCalled();
    });

    it("refuses a file larger than the limit that did not say so", async () => {
      const big = Buffer.alloc(MAX_CONTRACT_BYTES + 1);
      pdf.copy(big);

      const res = await upload(big);

      expect(res.status).toBe(413);
      expect(prismaMock.lease.update).not.toHaveBeenCalled();
    });

    it("answers 404 for another owner's lease, and writes nothing", async () => {
      prismaMock.lease.findFirst.mockResolvedValue(null);

      const res = await upload(pdf);

      expect(res.status).toBe(404);
      expect(prismaMock.lease.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "lease-1", userId: "user-1" } }),
      );
      expect(prismaMock.lease.update).not.toHaveBeenCalled();
    });
  });

  describe("GET", () => {
    const download = () => GET(new NextRequest(url), params);

    it("serves the decrypted PDF as a private download", async () => {
      prismaMock.lease.findFirst.mockResolvedValue({
        contractFile: encryptFile(pdf),
        contractFileName: "Contrato São Bento.pdf",
      });

      const res = await download();

      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(pdf)).toBe(true);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="Contrato S_o Bento.pdf"; filename*=UTF-8''${encodeURIComponent("Contrato São Bento.pdf")}`,
      );
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "DOWNLOAD_LEASE_CONTRACT", resourceId: "lease-1" }),
      );
    });

    // Asked for by name: the Prisma client leaves the bytes out of every read that does not.
    it("selects the bytes explicitly, on the caller's own lease", async () => {
      prismaMock.lease.findFirst.mockResolvedValue({
        contractFile: pdf,
        contractFileName: "c.pdf",
      });

      await download();

      expect(prismaMock.lease.findFirst).toHaveBeenCalledWith({
        where: { id: "lease-1", userId: "user-1" },
        select: { contractFile: true, contractFileName: true },
      });
    });

    it("serves a contract stored before encryption as it is", async () => {
      prismaMock.lease.findFirst.mockResolvedValue({ contractFile: pdf, contractFileName: null });

      const res = await download();

      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(pdf)).toBe(true);
      expect(res.headers.get("content-disposition")).toContain('filename="contract-lease-1.pdf"');
    });

    it("answers 404 when the lease has no contract, or is not the caller's", async () => {
      prismaMock.lease.findFirst.mockResolvedValueOnce({ contractFile: null });
      expect((await download()).status).toBe(404);

      prismaMock.lease.findFirst.mockResolvedValueOnce(null);
      expect((await download()).status).toBe(404);
    });

    it("answers 500, without the bytes, when the key has changed", async () => {
      prismaMock.lease.findFirst.mockResolvedValue({
        contractFile: encryptFile(pdf),
        contractFileName: "c.pdf",
      });
      process.env.PII_ENCRYPTION_KEY = "d".repeat(64);

      const res = await download();

      expect(res.status).toBe(500);
      expect(logAudit).not.toHaveBeenCalled();
    });
  });

  describe("DELETE", () => {
    const remove = () => DELETE(new NextRequest(url, { method: "DELETE" }), params);

    it("clears the contract and records it", async () => {
      const res = await remove();

      expect(res.status).toBe(200);
      expect(written()).toEqual({
        contractFile: null,
        contractFileName: null,
        contractFileSize: null,
      });
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "DELETE_LEASE_CONTRACT", resourceId: "lease-1" }),
      );
    });

    it("answers 404 for another owner's lease", async () => {
      prismaMock.lease.findFirst.mockResolvedValue(null);

      expect((await remove()).status).toBe(404);
      expect(prismaMock.lease.update).not.toHaveBeenCalled();
    });
  });
});

describe("contractFileName", () => {
  it("keeps the uploaded name, without a path, ending .pdf", () => {
    expect(contractFileName(encodeURIComponent("C:\\docs\\Contrato.pdf"), "l1")).toBe(
      "Contrato.pdf",
    );
    expect(contractFileName(encodeURIComponent("../../etc/Contrato"), "l1")).toBe("Contrato.pdf");
    expect(contractFileName(encodeURIComponent("Contrato\u0000\u0007 2026.PDF"), "l1")).toBe(
      "Contrato 2026.PDF",
    );
  });

  it("names the file after the lease when there is no usable name", () => {
    expect(contractFileName(null, "l1")).toBe("contract-l1.pdf");
    expect(contractFileName("%E0%A4%A", "l1")).toBe("contract-l1.pdf"); // malformed encoding
    expect(contractFileName(encodeURIComponent("/"), "l1")).toBe("contract-l1.pdf");
  });
});
