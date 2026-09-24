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
 *
 * The document-detail case was removed with the Documents UI in the scope cutdown. Two cases
 * below still stub `fetch` and render what comes back — the tax-connector one and the failed
 * request one — which is the property that matters here: a subject that never makes a request
 * asserts against a component that never rendered anything.
 */
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/tests/helpers/render-with-providers";
import { ExportButton } from "@/components/ui/export-button";
import { AuditTrail } from "@/components/shared/audit-trail";
import { FinancialsView } from "@/components/features/financial/financials-view";
import { TaxConnectorDashboard } from "@/components/features/financial/tax-connector-dashboard";
import { AuditTrail as AuditTrailForError } from "@/components/shared/audit-trail";
import { DraftBanner } from "@/components/ui/multi-step-form";
import ptMessages from "@/messages/pt.json";

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
  it("renders a failed request in Portuguese, not in the server's English", async () => {
    // The failure path was the last place English survived. Every route replies through
    // `createErrorResponse`, which writes English into the envelope, and around thirty
    // components rendered that string straight into a banner. Here the request 500s, so the
    // user must get `errors.api.serverError` — never the sentence the server chose.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "Database operation failed" }),
        }),
      ),
    );

    // A non-empty scope, because `resourceIds={[]}` means "nothing to look up" and returns
    // before it fetches — the first version of this test asserted against a component that
    // never made a request.
    renderWithProviders(<AuditTrailForError resourceIds={["p1"]} />, { initialLocale: "pt" });

    expect(await screen.findByText(ptMessages.errors.api.serverError)).toBeInTheDocument();
    expect(screen.queryByText(/Database operation failed/)).not.toBeInTheDocument();
  });

  it("names each audit action in Portuguese, and keeps the code of one no longer written", async () => {
    // Each row printed its stored action with the underscores removed: "UPLOAD LEASE CONTRACT"
    // in a Portuguese trail.
    const row = (id: string, action: string) => ({
      id,
      action,
      resourceType: "Lease",
      resourceId: "lease-1",
      createdAt: "2026-09-01T10:00:00Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                row("a1", "ALLOCATE_PAYMENT"),
                row("a2", "UPLOAD_LEASE_CONTRACT"),
                row("a3", "RETIRED_FEATURE_ACTION"),
                row("a4", "EXTRACT_LEASE_CONTRACT"),
              ],
            }),
        }),
      ),
    );

    renderWithProviders(<AuditTrail resourceIds={["lease-1"]} />, { initialLocale: "pt" });

    expect(await screen.findByText("Pagamento atribuído")).toBeInTheDocument();
    expect(screen.getByText("PDF do contrato carregado")).toBeInTheDocument();
    // The record of a contract leaving the instance says where it went.
    expect(screen.getByText("Contrato enviado à Anthropic para leitura")).toBeInTheDocument();
    // Rows outlive the code that wrote them; an action with no label keeps its stored code.
    expect(screen.getByText("RETIRED_FEATURE_ACTION")).toBeInTheDocument();
    expect(screen.queryByText(/ALLOCATE PAYMENT|UPLOAD LEASE CONTRACT/i)).not.toBeInTheDocument();
  });

  it("offers to restore a form draft in Portuguese", () => {
    // Every multi-step wizard shows this banner, and it was English in every language.
    renderWithProviders(<DraftBanner onRestore={vi.fn()} onDiscard={vi.fn()} />, {
      initialLocale: "pt",
    });

    expect(screen.getByText("Tem um rascunho por guardar. Quer continuar?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeInTheDocument();
  });
});
