import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { within } from "@testing-library/dom";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import type { AtReceiptMonth, AtReceiptPreview } from "@/lib/services/tax/at-receipts";
import type { Receipt } from "@/lib/types";

/**
 * The review Emitir opens in Finanças › Recibos: what each rent month would send to Finanças, what
 * stops it, and, in the test mode, what AT's test service answered. Asserted in Portuguese, since
 * asserting English cannot catch hardcoded English.
 */

const { apiFetchMock, downloadMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  downloadMock: vi.fn(),
}));

vi.mock("@/lib/utils/api-client", () => ({ apiFetch: apiFetchMock }));
vi.mock("@/lib/utils/download-pdf", () => ({ downloadBase64Pdf: downloadMock }));
vi.mock("@/lib/contexts/csrf-context", () => ({ useCsrf: () => ({ token: "csrf-token" }) }));
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({ formatCurrency: (amount: number) => `€${amount.toFixed(2)}` }),
}));

import { AtReceiptsSheet } from "./at-receipts-sheet";

const sheet = ptMessages.financial.receipts.atSheet;
const at = ptMessages.settings.at;

const receipt = (id: string, tenantName: string) =>
  ({
    id,
    tenantId: `tenant-${id}`,
    tenantName,
    propertyId: "prop-1",
    propertyName: "Rua Augusta 12",
    amount: 750,
    date: "2026-09-03",
    type: "rent",
    status: "paid",
    lifecycle: "draft",
  }) as unknown as Receipt;

function month(overrides: Partial<AtReceiptMonth> = {}): AtReceiptMonth {
  return {
    periodId: "period-9",
    year: 2026,
    month: 9,
    amount: 750,
    receivedOn: "2026-09-03",
    contractNumber: "1234567",
    contractVersion: 2,
    landlords: [{ name: "Ana Senhoria", nif: "123456789" }],
    tenants: [
      { name: "Rui Inquilino", nif: "234567899", country: "PT", document: null },
      { name: "Marie Colocataire", nif: null, country: "FR", document: "12AB34567" },
    ],
    blockers: [],
    ...overrides,
  };
}

function review(overrides: Partial<AtReceiptPreview> = {}): AtReceiptPreview {
  return {
    mode: "review",
    canTest: false,
    receipts: [{ receiptId: "r-1", refusal: null, months: [month()] }],
    ...overrides,
  };
}

/** Answers the review with `preview`, and anything else with what `others` gives for its URL. */
function answer(preview: AtReceiptPreview, others: Record<string, unknown> = {}) {
  apiFetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/tax/connectors/at/receipts/preview") return preview;
    if (url in others) return others[url];
    throw new Error(`unexpected ${url}`);
  });
}

function show(receipts: Receipt[] = [receipt("r-1", "Rui Inquilino")]) {
  const onIssue = vi.fn();
  const onClose = vi.fn();
  render(
    <AtReceiptsSheet receipts={receipts} onIssue={onIssue} onClose={onClose} issuing={false} />,
    {
      initialLocale: "pt",
    },
  );
  return { user: userEvent.setup(), onIssue, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AtReceiptsSheet — the review", () => {
  it("shows what Finanças would receive for each month, before anything is sent", async () => {
    answer(review());
    show();

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(sheet.ready)).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Emitir 1 recibo?");
    expect(dialog).toHaveTextContent(sheet.modeSimulated);
    expect(dialog).toHaveTextContent("setembro de 2026");
    expect(dialog).toHaveTextContent("Contrato na AT n.º 1234567, versão 2");
    expect(dialog).toHaveTextContent("Senhorios: Ana Senhoria, NIF 123456789");
    // A foreign co-tenant by the document and the country, named in Portuguese.
    expect(dialog).toHaveTextContent(
      "Inquilinos: Rui Inquilino, NIF 234567899 · Marie Colocataire, documento 12AB34567 (França)",
    );
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/tax/connectors/at/receipts/preview",
      "csrf-token",
      "POST",
      { receiptIds: ["r-1"] },
    );
  });

  it("says in Portuguese what stops a month, and why a whole receipt cannot go", async () => {
    answer(
      review({
        receipts: [
          {
            receiptId: "r-1",
            refusal: null,
            months: [
              month({
                contractNumber: null,
                blockers: [
                  { code: "contract_number_missing" },
                  { code: "tenant_nif_missing", name: "Rui Inquilino" },
                ],
              }),
            ],
          },
          { receiptId: "r-2", refusal: "not_rent", months: [] },
        ],
      }),
    );
    show([receipt("r-1", "Rui Inquilino"), receipt("r-2", "Eva Lima")]);

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(sheet.missing)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(sheet.blocker.contractNumberMissing);
    expect(dialog).toHaveTextContent("Rui Inquilino não tem NIF.");
    expect(dialog).toHaveTextContent(sheet.refusal.notRent);
    expect(within(dialog).queryByText(sheet.ready)).not.toBeInTheDocument();
  });

  it("issues in Situs from Emitir, as before", async () => {
    answer(review());
    const { user, onIssue } = show();

    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(sheet.ready);
    await user.click(within(dialog).getByRole("button", { name: "Emitir 1" }));

    expect(onIssue).toHaveBeenCalled();
  });

  it("says why the review could not load, in Portuguese", async () => {
    apiFetchMock.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    show();

    expect(await screen.findByRole("alert")).toHaveTextContent(ptMessages.errors.api.serverError);
  });
});

describe("AtReceiptsSheet — a test at AT", () => {
  it("offers no test outside the test mode", async () => {
    answer(review());
    show();

    await within(await screen.findByRole("dialog")).findByText(sheet.ready);
    expect(screen.queryByRole("button", { name: /Testar na AT/ })).not.toBeInTheDocument();
  });

  it("says what a test needs when the test mode lacks the login or the files", async () => {
    answer(review({ mode: "test", canTest: false }));
    show();

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(sheet.testUnavailable)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(sheet.modeTest);
    expect(screen.queryByRole("button", { name: /Testar na AT/ })).not.toBeInTheDocument();
  });

  it("sends only the receipts with a month ready, and shows what AT answered for each", async () => {
    answer(
      review({
        mode: "test",
        canTest: true,
        receipts: [
          {
            receiptId: "r-1",
            refusal: null,
            months: [
              month({ periodId: "p-7", month: 7 }),
              month({ periodId: "p-8", month: 8 }),
              month({ periodId: "p-9", month: 9 }),
            ],
          },
          {
            receiptId: "r-2",
            refusal: null,
            months: [month({ periodId: "p-x", blockers: [{ code: "contract_number_missing" }] })],
          },
        ],
      }),
      {
        "/api/tax/connectors/at/receipts/test": {
          receipts: [
            {
              receiptId: "r-1",
              refusal: null,
              months: [
                {
                  periodId: "p-7",
                  year: 2026,
                  month: 7,
                  status: "sent",
                  receiptNumber: 42,
                  call: { outcome: "answer", code: 0, category: "ok", message: "OK", errors: [] },
                },
                {
                  periodId: "p-8",
                  year: 2026,
                  month: 8,
                  status: "sent",
                  receiptNumber: null,
                  call: {
                    outcome: "answer",
                    code: -1,
                    category: "rejected",
                    message: "O recibo apresenta erros",
                    errors: [{ field: "valor", message: "Valor inválido" }],
                  },
                },
                { periodId: "p-9", year: 2026, month: 9, status: "skipped" },
              ],
            },
          ],
        },
      },
    );
    const { user } = show([receipt("r-1", "Rui Inquilino"), receipt("r-2", "Eva Lima")]);

    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Testar na AT (3)" }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/tax/connectors/at/receipts/test",
      "csrf-token",
      "POST",
      { receiptIds: ["r-1"] },
    );
    expect(await within(dialog).findByText(sheet.result.nothingRecorded)).toBeInTheDocument();
    expect(dialog).toHaveTextContent("O serviço de testes da AT emitiu o recibo n.º 42.");
    expect(dialog).toHaveTextContent(sheet.result.refused);
    expect(dialog).toHaveTextContent("valor: Valor inválido");
    expect(dialog).toHaveTextContent(sheet.result.skipped);
  });

  it("names a refused login in Portuguese, with AT's own words beside it", async () => {
    answer(review({ mode: "test", canTest: true }), {
      "/api/tax/connectors/at/receipts/test": {
        receipts: [
          {
            receiptId: "r-1",
            refusal: null,
            months: [
              {
                periodId: "period-9",
                year: 2026,
                month: 9,
                status: "sent",
                receiptNumber: null,
                call: {
                  outcome: "answer",
                  code: 99,
                  category: "password",
                  message: "Senha errada",
                  errors: [],
                },
              },
            ],
          },
        ],
      },
    });
    const { user } = show();

    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Testar na AT (1)" }));

    expect(await within(dialog).findByText(at.result.password)).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Resposta da AT: Senha errada");
  });

  it("fetches the PDF of the receipt AT's test service issued", async () => {
    answer(review({ mode: "test", canTest: true }), {
      "/api/tax/connectors/at/receipts/test": {
        receipts: [
          {
            receiptId: "r-1",
            refusal: null,
            months: [
              {
                periodId: "period-9",
                year: 2026,
                month: 9,
                status: "sent",
                receiptNumber: 42,
                call: { outcome: "answer", code: 0, category: "ok", message: "OK", errors: [] },
              },
            ],
          },
        ],
      },
      "/api/tax/connectors/at/receipt": {
        call: { outcome: "answer", code: 0, category: "ok", message: "OK", errors: [] },
        pdf: "JVBERi0=",
      },
    });
    const { user } = show();

    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Testar na AT (1)" }));
    await user.click(await within(dialog).findByRole("button", { name: sheet.result.fetchPdf }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/tax/connectors/at/receipt",
      "csrf-token",
      "POST",
      { contractNumber: 1234567, receiptNumber: 42 },
    );
    expect(downloadMock).toHaveBeenCalledWith("JVBERi0=", "recibo-1234567-42.pdf");
  });
});
