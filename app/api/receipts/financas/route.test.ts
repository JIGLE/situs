import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { jsPDF } from "jspdf";

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: vi.fn(async () => ({ userId: "user-1", scopeUserId: "user-1" })),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/receipts/financas-receipts", () => ({
  registerReceipt: vi.fn(async () => ({ outcome: "create", receiptIds: ["receipt-1"] })),
}));

import { POST } from "./route";
import { requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { registerReceipt } from "@/lib/services/receipts/financas-receipts";

function recibo(): Uint8Array {
  const doc = new jsPDF();
  [
    "RECIBO DE RENDA ELETRÓNICO",
    "RECIBO DE RENDA N.º 31 DATA DE EMISSÃO 2026-04-05",
    "Período a que respeita a renda 2026-04-01 a 2026-04-30",
    "Valor 700,00 Retenção de IRS 0,00 Importância Recebida 700,00",
  ].forEach((line, i) => doc.text(line, 10, 15 + i * 8));
  return new Uint8Array(doc.output("arraybuffer"));
}

const send = (query: string, body: Uint8Array = recibo()) =>
  POST(
    new NextRequest(`http://localhost:3000/api/receipts/financas?${query}`, {
      method: "POST",
      body: new Uint8Array(body),
      headers: { "Content-Type": "application/pdf" },
    }),
  );

describe("POST /api/receipts/financas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the recibo itself and registers it on the contract and month confirmed", async () => {
    const res = await send("leaseId=lease-1&month=2026-04&name=recibo.pdf");

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ outcome: "create", receiptIds: ["receipt-1"] });
    expect(registerReceipt).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        leaseId: "lease-1",
        month: { year: 2026, month: 4 },
        fileName: "recibo.pdf",
        parsed: expect.objectContaining({ number: "31", rent: 700 }),
      }),
    );
  });

  it("refuses a month that is not one, and a body that is not a PDF", async () => {
    expect((await send("leaseId=lease-1&month=2026-13&name=x")).status).toBe(400);
    expect((await send("month=2026-04&name=x")).status).toBe(400);
    expect(
      (await send("leaseId=lease-1&month=2026-04&name=x", new TextEncoder().encode("hello")))
        .status,
    ).toBe(415);
    expect(registerReceipt).not.toHaveBeenCalled();
  });

  it("checks the owner before reading anything", async () => {
    vi.mocked(requireOwnerAccess).mockResolvedValueOnce(
      new Response(null, { status: 401 }) as never,
    );
    expect((await send("leaseId=lease-1&month=2026-04&name=x")).status).toBe(401);
    expect(registerReceipt).not.toHaveBeenCalled();
  });
});
