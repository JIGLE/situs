import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import { RentHistorySheet } from "./rent-history-sheet";

const { app, toast, apiFetch } = vi.hoisted(() => ({
  app: { refreshData: vi.fn(async () => {}) },
  toast: { success: vi.fn(), error: vi.fn() },
  apiFetch: vi.fn(async (_url: string, init?: { method?: string }) =>
    init?.method === "PUT" ? { status: "matched_confirmed" } : { settled: 19 },
  ),
}));

vi.mock("@/lib/contexts/app-context", () => ({ useApp: () => app }));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/lib/utils/api-client", () => ({ apiFetch, csrfHeaders: () => ({}) }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

/**
 * A tenancy entered after it began: the months before the bank shows its rent count as paid before
 * Situs, and the movements that were its rent are confirmed, oldest first.
 */
describe("RentHistorySheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: new Date("2026-11-12T10:00:00.000Z"), toFake: ["Date"] });
  });

  it("tracks from the first payment the bank shows, and confirms the ones ticked", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <RentHistorySheet
        leaseId="lease-1"
        monthlyRent={850}
        onClose={onClose}
        history={{
          startMonth: "2025-02",
          openMonths: [
            { month: "2026-10", outstanding: 850 },
            { month: "2026-11", outstanding: 850 },
          ],
          suggestions: [
            {
              transactionId: "t1",
              bookingDate: "2026-10-01T00:00:00.000Z",
              amount: 850,
              counterpartyName: "MARIA DA SILVA",
              reference: null,
              reasons: ["name_match", "amount_exact"],
              likely: true,
            },
            {
              transactionId: "t2",
              bookingDate: "2026-10-03T00:00:00.000Z",
              amount: 850,
              counterpartyName: "OUTRA PESSOA",
              reference: null,
              reasons: ["amount_exact"],
              likely: false,
            },
          ],
        }}
      />,
      { initialLocale: "pt" },
    );

    expect(await screen.findByText(/Os meses antes de outubro de 2026/)).toBeInTheDocument();
    expect(screen.getByText("paga outubro de 2026")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const calls = (
      apiFetch.mock.calls as unknown as [string, { method: string; body: string }][]
    ).map(([url, init]) => [url, init.method, JSON.parse(init.body)]);
    expect(calls).toEqual([
      ["/api/leases/lease-1/rent-history", "POST", { from: "2026-10" }],
      ["/api/bank/transactions/t1", "PUT", { action: "confirm", leaseId: "lease-1" }],
    ]);
    expect(toast.success).toHaveBeenCalledWith("1 pagamento registado");
    vi.useRealTimers();
  });
});
