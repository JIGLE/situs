import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import pt from "@/messages/pt.json";
import type { Lease } from "@/lib/types";

const { apiFetch, refreshData, toast } = vi.hoisted(() => ({
  apiFetch: vi.fn(async () => ({})),
  refreshData: vi.fn(async () => {}),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/utils/api-client", () => ({ apiFetch }));
vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      tenants: [{ id: "tenant-1", name: "Ana Costa" }],
      properties: [{ id: "prop-1", address: "Rua Augusta 12" }],
    },
    refreshData,
  }),
}));
vi.mock("@/lib/contexts/csrf-context", () => ({ useCsrf: () => ({ token: "csrf" }) }));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({ formatCurrency: (n: number) => `${n.toFixed(2)} €` }),
}));

import { RentIncreaseDialog } from "./rent-increase-dialog";

const copy = pt.leases.rentIncrease;

const lease = (over: Partial<Lease> = {}): Lease =>
  ({
    id: "lease-1",
    tenantId: "tenant-1",
    propertyId: "prop-1",
    startDate: "2025-03-01",
    endDate: "2028-02-29",
    monthlyRent: 735,
    status: "active",
    rentIncreases: [],
    ...over,
  }) as Lease;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-20T10:00:00.000Z"));
});

/** The yearly update, scheduled for a month rather than written onto the lease at once. */
describe("RentIncreaseDialog", () => {
  it("suggests the contract's anniversary and INE's percentage, and schedules from that month", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<RentIncreaseDialog open onOpenChange={vi.fn()} leases={[lease()]} />, {
      initialLocale: "pt",
    });

    expect(screen.getByLabelText(copy.percent)).toHaveValue(2.24);
    expect(screen.getByLabelText(copy.startsIn)).toHaveValue("2026-03");
    expect(screen.getByText(/751\.46 €/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: copy.schedule }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/api/leases/lease-1/rent-increases", "csrf", "POST", {
        effectiveFrom: "2026-03",
        percent: 2.24,
        noticeDate: "2026-01-20",
      }),
    );
    expect(refreshData).toHaveBeenCalled();
  });

  it("warns when the chosen month leaves less than 30 days' notice", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<RentIncreaseDialog open onOpenChange={vi.fn()} leases={[lease()]} />, {
      initialLocale: "pt",
    });

    const month = screen.getByLabelText(copy.startsIn);
    await user.clear(month);
    await user.type(month, "2026-02");

    expect(screen.getByText(copy.warning.shortNotice.replace("{days}", "30"))).toBeInTheDocument();
    expect(screen.getByText(copy.warning.beforeAnniversary)).toBeInTheDocument();
  });

  it("leaves a lease that already has an increase waiting alone", () => {
    renderWithProviders(
      <RentIncreaseDialog
        open
        onOpenChange={vi.fn()}
        leases={[
          lease({
            rentIncreases: [
              {
                id: "inc-1",
                leaseId: "lease-1",
                effectiveFrom: "2026-03-01T00:00:00.000Z",
                previousRent: 735,
                newRent: 751.46,
                percent: 2.24,
                appliedAt: null,
                createdAt: "2026-01-02T00:00:00.000Z",
              },
            ],
          }),
        ]}
      />,
      { initialLocale: "pt" },
    );

    expect(screen.getByText(/Já marcada: 751\.46 €/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.schedule })).toBeDisabled();
  });
});
