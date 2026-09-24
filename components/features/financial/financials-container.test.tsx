import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import { FinancialsContainer } from "./financials-container";

/**
 * Which panel Finance shows. Each tab's view is stubbed to a label, so what is asserted is the
 * container's choice of panel, not the panels themselves.
 *
 * The receipt-based "Due & overdue" tab was removed. `useTabPersistence` restores the last tab
 * from localStorage without checking it still exists, so a returning owner's stored "queue"
 * selected no panel at all and left the page blank below the stat cards.
 */

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({ state: { receipts: [], tenants: [], leases: [], properties: [] } }),
}));

vi.mock("./receipts-view", () => ({ ReceiptsView: () => <p>receipts panel</p> }));
vi.mock("./rent-roll-view", () => ({ RentRollView: () => <p>rent roll panel</p> }));
vi.mock("./yearly-rent-matrix", () => ({ YearlyRentMatrix: () => <p>rent matrix panel</p> }));
vi.mock("./bank-movements-inbox", () => ({ BankMovementsInbox: () => <p>bank panel</p> }));
vi.mock("./receipt-automation-queue", () => ({ ReceiptAutomationQueue: () => null }));
vi.mock("./tax-connector-dashboard", () => ({ TaxConnectorDashboard: () => null }));
vi.mock("./financials-view", () => ({ FinancialsView: () => <p>tax panel</p> }));

describe("FinancialsContainer", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("opens on the rent matrix", async () => {
    render(<FinancialsContainer />);

    expect(await screen.findByText("rent matrix panel")).toBeInTheDocument();
  });

  it("falls back to the rent matrix when the stored tab no longer exists", async () => {
    localStorage.setItem("tab-payments", "queue");

    render(<FinancialsContainer />);

    expect(await screen.findByText("rent matrix panel")).toBeInTheDocument();
  });

  it("still restores a stored tab that exists", async () => {
    localStorage.setItem("tab-payments", "bank");

    render(<FinancialsContainer />);

    expect(await screen.findByText("bank panel")).toBeInTheDocument();
    expect(screen.queryByText("rent matrix panel")).not.toBeInTheDocument();
  });
});
