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

vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({ formatCurrency: (n: number) => `€${n.toFixed(2)}` }),
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
});
