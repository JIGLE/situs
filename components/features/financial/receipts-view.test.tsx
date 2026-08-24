import { describe, it, expect, vi } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import { ReceiptsView } from "./receipts-view";

// Mock the currency hook
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: { receipts: [], tenants: [], properties: [], loading: false },
    addReceipt: vi.fn(),
    updateReceipt: vi.fn(),
    deleteReceipt: vi.fn(),
  }),
}));

vi.mock("@/lib/contexts/toast-context", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

describe("ReceiptsView", () => {
  it("renders empty receipts state", () => {
    render(<ReceiptsView />);
    expect(screen.getAllByText("Receipts").length).toBeGreaterThan(0);
  });
});
