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
vi.mock("./financials-view", () => ({ FinancialsView: () => <p>tax panel</p> }));

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

  it("counts the receipts waiting to be issued on the Receipts tab", async () => {
    appState.receipts = [
      { id: "a", lifecycle: "draft" },
      { id: "b", lifecycle: "review" },
      { id: "c", lifecycle: "emitted" },
    ];

    render(<FinancialsContainer />);

    expect(await screen.findByRole("tab", { name: /Receipts\s*2$/ })).toBeInTheDocument();
    appState.receipts = [];
  });

  it("opens on the rent matrix", async () => {
    render(<FinancialsContainer />);

    expect(await screen.findByText("rent matrix panel")).toBeInTheDocument();
  });

  it("falls back to the rent matrix when the stored tab no longer exists", async () => {
    localStorage.setItem("tab-payments", "queue");

    render(<FinancialsContainer />);

    expect(await screen.findByText("rent matrix panel")).toBeInTheDocument();
  });

  it("opens the rent matrix for a stored tab that was folded into it", async () => {
    // "Ocupação e renda" became the matrix's totals row; an owner who last left it open lands
    // on the matrix rather than on a blank page.
    localStorage.setItem("tab-payments", "rent-roll");

    render(<FinancialsContainer />);

    expect(await screen.findByText("rent matrix panel")).toBeInTheDocument();
  });

  it("opens Record payment where the owner is, without changing tab", async () => {
    const user = userEvent.setup();
    render(<FinancialsContainer />);
    expect(await screen.findByText("rent matrix panel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(await screen.findByRole("dialog", { name: "Record payment" })).toBeInTheDocument();
    expect(screen.getByText("rent matrix panel")).toBeInTheDocument();
  });

  it("still restores a stored tab that exists", async () => {
    localStorage.setItem("tab-payments", "bank");

    render(<FinancialsContainer />);

    expect(await screen.findByText("bank panel")).toBeInTheDocument();
    expect(screen.queryByText("rent matrix panel")).not.toBeInTheDocument();
  });

  it("opens the tab a link names, then lets the owner choose another", async () => {
    const user = userEvent.setup();
    install("tab=receipts&tenantId=t-1");

    render(<FinancialsContainer />);
    act(() => address.flush());

    expect(await screen.findByText("receipts panel")).toBeInTheDocument();
    // The link's tab moves to `view`; the tenant filter stays.
    expect(new URLSearchParams(address.search).get("tab")).toBeNull();
    expect(new URLSearchParams(address.search).get("view")).toBe("receipts");
    expect(new URLSearchParams(address.search).get("tenantId")).toBe("t-1");

    await user.click(screen.getByRole("tab", { name: /bank movements/i }));
    act(() => address.flush());

    expect(await screen.findByText("bank panel")).toBeInTheDocument();
    expect(screen.queryByText("receipts panel")).not.toBeInTheDocument();
    expect(new URLSearchParams(address.search).get("view")).toBe("bank");
  });

  it("shows the link's tab without waiting for the router", async () => {
    install("tab=receipts");

    render(<FinancialsContainer />);

    // Nothing flushed: the address still reads `?tab=receipts`.
    expect(await screen.findByText("receipts panel")).toBeInTheDocument();
  });

  it("keeps a tab picked before the address caught up with the link", async () => {
    const user = userEvent.setup();
    install("tab=receipts");

    render(<FinancialsContainer />);
    expect(await screen.findByText("receipts panel")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /bank movements/i }));
    act(() => address.flush());

    expect(await screen.findByText("bank panel")).toBeInTheDocument();
    expect(new URLSearchParams(address.search).get("view")).toBe("bank");
  });

  it("reads the old overview link as the tax summary", async () => {
    install("tab=overview");

    render(<FinancialsContainer />);
    act(() => address.flush());

    expect(await screen.findByText("tax panel")).toBeInTheDocument();
    expect(address.search).toBe("view=tax");
  });

  it("drops the record-payment link once read, keeping the tab it names", async () => {
    install("tab=receipts&action=record-payment");

    render(<FinancialsContainer />);
    act(() => address.flush());

    expect(await screen.findByText("receipts panel")).toBeInTheDocument();
    expect(address.search).toBe("view=receipts");
  });
});
