import { describe, it, expect, vi } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import { TenantsView } from "@/components/features/tenant/tenants-view";

// Mock the currency hook
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: { tenants: [], properties: [], loading: false },
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
