import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireAuthMock, prismaMock, readFileMock, createDocumentMock, classifyMock } = vi.hoisted(
  () => ({
    requireAuthMock: vi.fn(),
    prismaMock: {
      inboundAttachment: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    },
    readFileMock: vi.fn(),
    createDocumentMock: vi.fn(),
    classifyMock: vi.fn(),
  }),
);

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: requireAuthMock,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("fs/promises", () => ({ readFile: readFileMock, default: { readFile: readFileMock } }));
vi.mock("@/lib/services/document-service", () => ({
  documentService: { create: createDocumentMock },
}));
vi.mock("@/lib/services/ocr/service", () => ({ classifyAndPersist: classifyMock }));

import { POST } from "./[id]/save/route";

const postRequest = () =>
  new NextRequest("http://localhost:3000/api/inbound-attachments/att-1/save", {
    method: "POST",
  });

const context = { params: { id: "att-1" } };

const BASE_ATTACHMENT = {
  id: "att-1",
  filename: "leak.jpg",
  mimeType: "image/jpeg",
  fileSize: 2048,
  storagePath: "/uploads/inbound/msg-1/abc.jpg",
  documentId: null,
  message: { tenantId: "tenant-9", propertyId: "prop-1" },
};

describe("POST /api/inbound-attachments/[id]/save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: "user-123" });
    readFileMock.mockResolvedValue(Buffer.from("fake-image-bytes"));
    createDocumentMock.mockResolvedValue({ id: "doc-1" });
    classifyMock.mockResolvedValue(undefined);
  });

  it("404s for an attachment belonging to someone else's message", async () => {
    prismaMock.inboundAttachment.findFirst.mockResolvedValue(null);

    const res = await POST(postRequest(), context);

    expect(res.status).toBe(404);
    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it("409s when the attachment was already saved", async () => {
    prismaMock.inboundAttachment.findFirst.mockResolvedValue({
      ...BASE_ATTACHMENT,
      documentId: "doc-existing",
    });

    const res = await POST(postRequest(), context);

    expect(res.status).toBe(409);
    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it("creates a Document from the attachment's own bytes, inheriting the message's tenant/property", async () => {
    prismaMock.inboundAttachment.findFirst.mockResolvedValue(BASE_ATTACHMENT);

    const res = await POST(postRequest(), context);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.documentId).toBe("doc-1");
    expect(readFileMock).toHaveBeenCalledWith(BASE_ATTACHMENT.storagePath);
    expect(createDocumentMock).toHaveBeenCalledWith(
      "user-123",
      expect.objectContaining({
        name: "leak.jpg",
        mimeType: "image/jpeg",
        tenantId: "tenant-9",
        propertyId: "prop-1",
      }),
    );
    expect(prismaMock.inboundAttachment.update).toHaveBeenCalledWith({
      where: { id: "att-1" },
      data: { documentId: "doc-1" },
    });
  });

  it("still saves the document when best-effort OCR classification throws", async () => {
    prismaMock.inboundAttachment.findFirst.mockResolvedValue(BASE_ATTACHMENT);
    classifyMock.mockRejectedValue(new Error("classifier is mock-only and unhappy"));

    const res = await POST(postRequest(), context);

    expect(res.status).toBe(201);
    expect(prismaMock.inboundAttachment.update).toHaveBeenCalled();
  });
});
