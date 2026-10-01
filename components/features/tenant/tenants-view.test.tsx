import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import { fireEvent, waitFor } from "@testing-library/react";
import { TenantsView } from "@/components/features/tenant/tenants-view";

// Mock the currency hook
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

const { app } = vi.hoisted(() => ({ app: { tenants: [] as unknown[] } }));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: { tenants: app.tenants, properties: [], leases: [], loading: false },
    addTenant: vi.fn(),
    updateTenant: vi.fn(),
    deleteTenant: vi.fn(),
  }),
}));

vi.mock("@/lib/contexts/toast-context", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

describe("TenantsView", () => {
  it("renders empty state when no tenants", () => {
    render(<TenantsView />);
    // `tenants.title` does not exist in any catalogue — this asserted a key the mock invented,
    // so it passed while proving nothing. The search box is real and always present.
    expect(screen.getByPlaceholderText("Search tenants…")).toBeDefined();
  });
});

/**
 * A tenant read from Finanças has a name and a NIF, and no email or phone: both are null. The list
 * searched them with `tenant.email.toLowerCase()`, which throws on null, so one such tenant took the
 * whole screen down; and it showed the word "null" where an address goes.
 */
describe("TenantsView, a tenant with no email or phone", () => {
  const ana = {
    id: "t1",
    userId: "user-1",
    name: "Ana Costa",
    email: null,
    phone: null,
    rent: 0,
    leaseStart: "2026-01-01",
    leaseEnd: "2026-12-31",
    paymentStatus: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    app.tenants = [ana];
  });

  it("lists them, with a dash where the address and the number would be", () => {
    render(<TenantsView />);

    expect(screen.getAllByText("Ana Costa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it("searches without throwing, and finds them by name only", async () => {
    render(<TenantsView />);
    const search = screen.getByPlaceholderText("Search tenants…");

    fireEvent.change(search, { target: { value: "ana" } });
    expect(screen.getAllByText("Ana Costa").length).toBeGreaterThan(0);

    // Not found: the rows go. The search settles after a short delay.
    fireEvent.change(search, { target: { value: "zzz" } });
    await waitFor(() => expect(screen.queryAllByText("Ana Costa")).toHaveLength(0));
    // Gone because it was filtered out, not because the screen came down: the search box is still here.
    expect(screen.getByPlaceholderText("Search tenants…")).toBeInTheDocument();
  });
});
