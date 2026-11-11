import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import { createFakeAddress } from "@/tests/helpers/fake-address";
import { FinancialsContainer } from "./financials-container";

/**
 * Which panel Finance shows. Each tab's view is stubbed to a label, so what is asserted is the
 * container's choice of panel, not the panels themselves.
 *
 * The receipt-based "Due & overdue" tab was removed. `useTabPersistence` restores the last tab
 * from localStorage without checking it still exists, so a returning owner's stored "queue"
 * selected no panel at all and left the page blank below the stat cards.
 *
 * Finance was regrouped from Receipts, Rent matrix, Bank movements and Tax summary into Ledger,
 * Movements, Expenses and Reports. An old tab name, stored or linked, opens the tab it became.
 *
 * Links elsewhere open a tab with `?tab=`. The page used to apply it again after every tab change,
 * so once a link had opened Receipts, choosing any other tab snapped straight back to Receipts.
 */

const { appState } = vi.hoisted(() => ({ appState: { receipts: [] as unknown[] } }));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: { receipts: appState.receipts, tenants: [], leases: [], properties: [] },
  }),
}));

vi.mock("./receipts-view", () => ({ ReceiptsView: () => <p>receipts panel</p> }));
vi.mock("./yearly-rent-matrix", () => ({ YearlyRentMatrix: () => <p>rent matrix panel</p> }));
vi.mock("./bank-movements-inbox", () => ({ BankMovementsInbox: () => <p>bank panel</p> }));
vi.mock("./tax-connector-dashboard", () => ({ TaxConnectorDashboard: () => null }));
vi.mock("./financials-view", () => ({ FinancialsView: () => <p>figures panel</p> }));
vi.mock("./expenses-view", () => ({ ExpensesView: () => <p>expenses panel</p> }));

let address: ReturnType<typeof createFakeAddress>;

function install(search: string) {
  address = createFakeAddress("/en/financials", search);
  vi.mocked(useSearchParams).mockImplementation(address.useSearchParams);
  vi.mocked(useRouter).mockReturnValue(address.router);
  vi.mocked(usePathname).mockImplementation(address.usePathname);
}

describe("FinancialsContainer", () => {
  beforeEach(() => {
    localStorage.clear();
    install("");
  });
  afterEach(() => localStorage.clear());

  it("has four tabs, and opens on the ledger", async () => {
    render(<FinancialsContainer />);

    expect(await screen.findByText("rent matrix panel")).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab: HTMLElement) => tab.textContent)).toEqual([
      "Ledger",
      "Movements",
      "Expenses",
      "Reports",
    ]);
  });

  it("falls back to the ledger when the stored tab no longer exists", async () => {
    localStorage.setItem("tab-payments", "queue");

    render(<FinancialsContainer />);

    expect(await screen.findByText("rent matrix panel")).toBeInTheDocument();
  });

  it.each([
    ["rent-matrix", "rent matrix panel"],
    ["bank", "bank panel"],
    ["receipts", "receipts panel"],
    ["tax", "receipts panel"],
  ])("opens the tab a stored %s became", async (stored, panel) => {
    localStorage.setItem("tab-payments", stored);

    render(<FinancialsContainer />);

    expect(await screen.findByText(panel)).toBeInTheDocument();
  });

  it("shows the figures, the receipts register and the filings together in Reports", async () => {
    localStorage.setItem("tab-payments", "reports");

    render(<FinancialsContainer />);

    expect(await screen.findByText("figures panel")).toBeInTheDocument();
    expect(screen.getByText("receipts panel")).toBeInTheDocument();
  });

  it("opens Record payment where the owner is, without changing tab", async () => {
    const user = userEvent.setup();
    render(<FinancialsContainer />);
    expect(await screen.findByText("rent matrix panel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(await screen.findByRole("dialog", { name: "Record payment" })).toBeInTheDocument();
    expect(screen.getByText("rent matrix panel")).toBeInTheDocument();
  });

  it("opens the tab a link names, then lets the owner choose another", async () => {
    const user = userEvent.setup();
    install("tab=expenses&tenantId=t-1");

    render(<FinancialsContainer />);
    act(() => address.flush());

    expect(await screen.findByText("expenses panel")).toBeInTheDocument();
    // The link's tab moves to `view`; the tenant filter stays.
    expect(new URLSearchParams(address.search).get("tab")).toBeNull();
    expect(new URLSearchParams(address.search).get("view")).toBe("expenses");
    expect(new URLSearchParams(address.search).get("tenantId")).toBe("t-1");

    await user.click(screen.getByRole("tab", { name: /movements/i }));
    act(() => address.flush());

    expect(await screen.findByText("bank panel")).toBeInTheDocument();
    expect(screen.queryByText("expenses panel")).not.toBeInTheDocument();
    expect(new URLSearchParams(address.search).get("view")).toBe("movements");
  });

  it("shows the link's tab without waiting for the router", async () => {
    install("tab=movements");

    render(<FinancialsContainer />);

    // Nothing flushed: the address still reads `?tab=movements`.
    expect(await screen.findByText("bank panel")).toBeInTheDocument();
  });

  it("keeps a tab picked before the address caught up with the link", async () => {
    const user = userEvent.setup();
    install("tab=expenses");

    render(<FinancialsContainer />);
    expect(await screen.findByText("expenses panel")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /movements/i }));
    act(() => address.flush());

    expect(await screen.findByText("bank panel")).toBeInTheDocument();
    expect(new URLSearchParams(address.search).get("view")).toBe("movements");
  });

  it.each([
    ["bank", "movements", "bank panel"],
    ["rent-matrix", "ledger", "rent matrix panel"],
    ["receipts", "reports", "receipts panel"],
    ["tax", "reports", "receipts panel"],
    ["overview", "reports", "receipts panel"],
  ])("reads an old %s link as %s", async (old, now, panel) => {
    install(`tab=${old}`);

    render(<FinancialsContainer />);
    act(() => address.flush());

    expect(await screen.findByText(panel)).toBeInTheDocument();
    expect(address.search).toBe(`view=${now}`);
  });

  it("drops the record-payment link once read, keeping the tab it names", async () => {
    install("tab=reports&action=record-payment");

    render(<FinancialsContainer />);
    act(() => address.flush());

    expect(await screen.findByText("receipts panel")).toBeInTheDocument();
    expect(address.search).toBe("view=reports");
  });
});
