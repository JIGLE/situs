import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1" })),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/document-service", () => ({ documentService: { create } }));

import { POST } from "./route";

const post = (body: BodyInit, type: string, query = "name=fatura.pdf&propertyId=prop-1") =>
  POST(
    new NextRequest(`http://localhost:3000/api/expenses/invoice?${query}`, {
      method: "POST",
      body,
      headers: { "Content-Type": type },
    }),
  );

/** The file behind a confirmed expense: kept as the caller's invoice Document. */
describe("POST /api/expenses/invoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValue({ id: "doc-1", name: "fatura.pdf" });
  });

  it("keeps a PDF as an invoice of the caller's, against the property", async () => {
    const res = await post("%PDF-1.7 …", "application/pdf");

    expect(res.status).toBe(201);
    expect((await res.json()).data).toEqual({ id: "doc-1", name: "fatura.pdf" });
    expect(create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        type: "invoice",
        mimeType: "application/pdf",
        name: "fatura.pdf",
        propertyId: "prop-1",
      }),
    );
  });

  it("refuses a file that is neither a PDF nor an image", async () => {
    const res = await post("<html>", "text/html");

    expect(res.status).toBe(415);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses an empty body", async () => {
    const res = await post("", "image/jpeg");

    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
