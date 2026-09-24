import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import enMessages from "@/messages/en.json";
import ptMessages from "@/messages/pt.json";
import { LeaseDetailView } from "./lease-detail-view";

const { app, toast, lease } = vi.hoisted(() => ({
  app: { updateLease: vi.fn(), refreshData: vi.fn(), leases: [] as unknown[] },
  toast: { success: vi.fn(), error: vi.fn() },
  lease: {
    id: "lease-1",
    tenantId: "tenant-1",
    propertyId: "prop-1",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    monthlyRent: 950,
    deposit: 1900,
    status: "active",
    renewalStatus: null as string | null,
  },
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: { leases: app.leases, properties: [], tenants: [], receipts: [] },
    updateLease: app.updateLease,
    refreshData: app.refreshData,
  }),
}));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({ formatCurrency: (n: number) => `€${n}` }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const detail = enMessages.leases.detail;

/**
 * The renewal route saves the offer and answers with the updated lease. The screen then handed that
 * lease to `updateLease`, which PUT all of it back to /api/leases/[id] — relation objects, ids and
 * the renewal columns — a second write of something already saved, and one the update route could
 * reject, turning a renewal that had been sent into a "couldn't send" toast.
 */
describe("LeaseDetailView renewal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an offer once and reloads, without writing the lease back", async () => {
    app.leases = [{ ...lease, renewalStatus: null }];
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ...lease, renewalStatus: "offered" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<LeaseDetailView leaseId="lease-1" />);

    await user.click(screen.getByRole("button", { name: /Offer Renewal/ }));
    await user.click(screen.getByRole("button", { name: detail.sendRenewal }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(detail.toastRenewalSent));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(app.updateLease).not.toHaveBeenCalled();
    expect(app.refreshData).toHaveBeenCalledTimes(1);
  });

  it("withdraws an offer once and reloads, without writing the lease back", async () => {
    app.leases = [{ ...lease, renewalStatus: "offered" }];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(lease)));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<LeaseDetailView leaseId="lease-1" />);

    await user.click(screen.getByRole("button", { name: /Withdraw Offer/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(detail.toastRenewalWithdrawn));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(app.updateLease).not.toHaveBeenCalled();
    expect(app.refreshData).toHaveBeenCalledTimes(1);
  });
});

/**
 * Asserted in Portuguese because asserting English cannot catch hardcoded English: the renewal and
 * edit buttons were literal English strings.
 */
describe("LeaseDetailView in Portuguese", () => {
  const pt = ptMessages.leases;

  it("names the renewal and edit actions in the reader's language", () => {
    app.leases = [{ ...lease, renewalStatus: null }];
    renderWithProviders(<LeaseDetailView leaseId="lease-1" />, { initialLocale: "pt" });

    expect(screen.getByRole("button", { name: pt.offerRenewal })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ptMessages.actions.edit })).toBeInTheDocument();
    expect(screen.queryByText(/Offer Renewal|^\s*Edit\s*$/)).not.toBeInTheDocument();
  });

  it("names the withdraw action in the reader's language", () => {
    app.leases = [{ ...lease, renewalStatus: "offered" }];
    renderWithProviders(<LeaseDetailView leaseId="lease-1" />, { initialLocale: "pt" });

    expect(screen.getByRole("button", { name: pt.detail.withdrawOffer })).toBeInTheDocument();
    expect(screen.queryByText(/Withdraw Offer/)).not.toBeInTheDocument();
  });

  it("writes the lease's dates the Portuguese way, not as stored", () => {
    app.leases = [{ ...lease, renewalStatus: null }];
    renderWithProviders(<LeaseDetailView leaseId="lease-1" />, { initialLocale: "pt" });

    expect(screen.getByText("01/01/2026 — 31/12/2026")).toBeInTheDocument();
    expect(screen.getByText("31/12/2026")).toBeInTheDocument();
    expect(screen.queryByText(/2026-01-01|2026-12-31/)).not.toBeInTheDocument();
  });
});

/**
 * What a contract import kept of the lease's clauses: each kind named in the reader's language,
 * its summary, and the words it was read from with their page.
 */
describe("LeaseDetailView clauses", () => {
  const pt = ptMessages.leases;

  it("lists the imported clauses, in Portuguese", () => {
    app.leases = [
      {
        ...lease,
        clauses: [
          {
            id: "clause-1",
            kind: "rent_update",
            summary: "A renda é atualizada todos os anos.",
            quote: "A renda será atualizada anualmente.",
            page: 3,
          },
        ],
      },
    ];
    renderWithProviders(<LeaseDetailView leaseId="lease-1" />, { initialLocale: "pt" });

    expect(screen.getByText(pt.detail.clauses)).toBeInTheDocument();
    expect(screen.getByText(pt.import.clauseKind.rent_update)).toBeInTheDocument();
    expect(screen.getByText("A renda é atualizada todos os anos.")).toBeInTheDocument();
    expect(
      screen.getByText(
        pt.import.source
          .replace("{page}", "3")
          .replace("{quote}", "A renda será atualizada anualmente."),
      ),
    ).toBeInTheDocument();
  });

  it("shows no clauses section for a lease typed in by hand", () => {
    app.leases = [{ ...lease }];
    renderWithProviders(<LeaseDetailView leaseId="lease-1" />, { initialLocale: "pt" });

    expect(screen.queryByText(pt.detail.clauses)).not.toBeInTheDocument();
  });
});
