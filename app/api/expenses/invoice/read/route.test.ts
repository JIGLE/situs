import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1" })),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/financas-import/read-upload", () => ({
  readUploadedPdf: vi.fn(async () => ({
    bytes: Buffer.from(""),
    pdf: { pages: ["Águas do Porto NIF: 507718666  Data: 04-11-2026  Total 18,20 €"], items: [] },
  })),
}));

import { POST } from "./route";

/** A PDF invoice, read for the form: what it says, nothing stored. */
describe("POST /api/expenses/invoice/read", () => {
  it("answers the supplier, the day and the total", async () => {
    const res = await POST(
      new NextRequest("http://localhost:3000/api/expenses/invoice/read", {
        method: "POST",
        body: "%PDF-",
        headers: { "Content-Type": "application/pdf" },
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      supplierNif: "507718666",
      date: "2026-11-04",
      total: 18.2,
      source: "text",
    });
  });
});
