/**
 * @vitest-environment jsdom
 */
/**
 * The tripwire for hardcoded user-visible strings.
 *
 * Six of them shipped into a fully Portuguese UI during one polish pass — `Paid`, `{n}d left`,
 * `Audit trail`, `Loading…`, `PT · NORMAL`, and `Export` across five surfaces — and every one had
 * to be found by reading a screenshot. Nothing in CI could see them.
 *
 * The obvious guard does not work: asserting English copy cannot catch a component that hardcodes
 * English, because the hardcoded string IS the expected string. A test like
 * `getByText("Export")` passes identically whether the label came from the catalogue or from a
 * string literal.
 *
 * So assert Portuguese. A component that bypasses `useTranslations` renders English here and
 * fails immediately.
 *
 * `npm run i18n:check:strict` does not overlap with this. It verifies the four catalogues agree
 * with each other — never that a component asked them anything.
 *
 * Keep this small and pointed at high-traffic shared components. It is a tripwire for a class of
 * defect, not coverage of every string; a test asserting hundreds of translations becomes a
 * second catalogue to maintain and gets deleted the first time it is annoying.
 */
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/tests/helpers/render-with-providers";
import { ExportButton } from "@/components/ui/export-button";
import { AuditTrail } from "@/components/shared/audit-trail";
import { FinancialsView } from "@/components/features/financial/financials-view";
import { TaxConnectorDashboard } from "@/components/features/financial/tax-connector-dashboard";
import { DocumentDetailPanel } from "@/components/features/document/document-detail-panel";

vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatCurrency: (n: number) => `€${n.toFixed(2)}`,
    currencySymbol: "€",
  }),
}));

vi.mock("@/lib/contexts/csrf-context", () => ({
  useCsrf: () => ({ token: "test-csrf-token" }),
}));

vi.mock("@/lib/contexts/toast-context", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const TODAY = new Date().toISOString().slice(0, 10);

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    addExpense: vi.fn(),
    addReceipt: vi.fn(),
    state: {
      loading: false,
      properties: [{ id: "p1", name: "Rua A, 1" }],
      receipts: [
        {
          id: "r1",
          number: "REC-1",
          date: TODAY,
          amount: 800,
          status: "paid",
          type: "rent",
          tenantName: "Ana",
          propertyName: "Rua A, 1",
        },
      ],
      expenses: [
        {
          id: "e1",
          date: TODAY,
          amount: 120,
          category: "condominium_fees",
          propertyName: "Rua A, 1",
        },
      ],
    },
  }),
}));

describe("user-visible copy comes from the catalogue, not from literals", () => {
  it("renders the export control in Portuguese", () => {
    renderWithProviders(
      <ExportButton
        data={[{ id: "1", name: "Ana" }]}
        columns={[{ key: "name", label: "Nome" }]}
        filename="x"
      />,
      { initialLocale: "pt" },
    );

    // "Exportar", not "Export". This button sits on Leases, Finances, Assets, Operations and
    // People, so one literal here shows an English word on five surfaces.
    expect(screen.getByRole("button", { name: /Exportar/ })).toBeInTheDocument();
  });

  it("renders the audit trail's empty state in Portuguese", () => {
    // No fetch stub: the request rejects, which is fine — the component's own strings are what is
    // under test, and the loading state is translated too.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })),
    );

    renderWithProviders(<AuditTrail resourceIds={[]} />, { initialLocale: "pt" });

    // Its `emptyTitle`/`emptyDescription` props used to default to English literals in the
    // parameter list, so any caller that did not pass its own copy printed "Audit trail" into a
    // Portuguese screen.
    expect(screen.getByText("Registo de auditoria")).toBeInTheDocument();
  });

  it("renders the Finances tax tab in Portuguese", () => {
    // This whole view rendered in English inside the Portuguese app for as long as it has
    // existed: a page title reading literally "Accounts", "Total Income", "This Month",
    // "No income records found" — while `financial.*` held correct Portuguese for all of them
    // and the component simply never called `t` for them. It was found by reading a screenshot,
    // which is the failure mode this file exists to end.
    renderWithProviders(<FinancialsView />, { initialLocale: "pt" });

    // The section heading, and the inline stat line that replaced the three tiles.
    expect(screen.getByRole("heading", { name: "Financeiro" })).toBeInTheDocument();
    expect(screen.getByText(/Receita Total/)).toBeInTheDocument();

    // The two card headings that used to read "Income & Receipts" and "Expenses".
    expect(screen.getByText("Receitas e recibos")).toBeInTheDocument();
    expect(screen.getByText("Despesas")).toBeInTheDocument();

    // The primary action. (The range control's options live inside a closed Radix Select and
    // are not in the tree until it opens, so they are not asserted here.)
    expect(screen.getByRole("button", { name: /Adicionar Despesa/ })).toBeInTheDocument();

    // Row-level copy, which is where the leaks hid longest: the status pill printed the raw
    // enum ("paid") and the category printed a de-underscored enum ("Condominium Fees").
    expect(screen.getByText("Pago")).toBeInTheDocument();
    expect(screen.getByText("Quotas de Condomínio")).toBeInTheDocument();
  });

  it("renders the tax-connector empty state in Portuguese", async () => {
    // Mounted directly above `FinancialsView` in the same tab panel, so it was the last English
    // sentence left on an otherwise translated screen — visible in the capture that prompted
    // this work.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { connectors: [], logs: {} } }),
        }),
      ),
    );

    renderWithProviders(<TaxConnectorDashboard />, { initialLocale: "pt" });

    expect(await screen.findByText(/Ainda sem conectores fiscais/)).toBeInTheDocument();
  });
  it("renders a document's type and expiry in Portuguese", async () => {
    // `documentTypeConfig` held the English word for each type ("Contract", "Floor Plan") and
    // three components rendered it straight into a Badge — the type filter, the upload dialog's
    // type Select, and every document card and detail panel. The Portuguese was in the catalogue
    // the entire time, under `documents.contract` and its six siblings; nothing asked for it.
    //
    // `getExpiryInfo` was the same defect one function over: it built "Expired" and
    // `Expires in ${days}d` itself and handed back finished English.
    const in7Days = new Date(Date.now() + 7 * 86400000).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                id: "d1",
                name: "Contrato Ana.pdf",
                type: "contract",
                mimeType: "application/pdf",
                storagePath: "/x",
                fileSize: 1024,
                expiresAt: in7Days,
                uploadedAt: TODAY,
                createdAt: TODAY,
                updatedAt: TODAY,
              },
            }),
        }),
      ),
    );

    renderWithProviders(<DocumentDetailPanel documentId="d1" />, { initialLocale: "pt" });

    // "Contrato", not "Contract".
    expect(await screen.findByText("Contrato")).toBeInTheDocument();
    // "Expira em 7 d", not "Expires in 7d".
    expect(screen.getByText(/Expira em/)).toBeInTheDocument();
    // The download action, which was a bare literal in the JSX next to the icon.
    expect(screen.getByRole("button", { name: /Transferir/ })).toBeInTheDocument();
  });
});
