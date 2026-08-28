import { describe, it, expect, vi } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import { PropertiesView } from "@/components/features/property/property-list";

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => ({
    get: vi.fn(),
  }),
  usePathname: () => "/portfolio",
}));

// Mock the currency hook
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: { properties: [], loading: false },
    addProperty: vi.fn(),
    updateProperty: vi.fn(),
    deleteProperty: vi.fn(),
  }),
}));

vi.mock("@/lib/contexts/toast-context", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

describe("PropertiesView", () => {
  it("renders the portfolio view when there are no properties", () => {
    render(<PropertiesView />);
    // Tree is the default view; its compact asset filter renders above the tree.
    // Asserts the copy a user reads. It used to assert the key — the comment here said so
    // outright, "the next-intl mock returns the key" — which meant it could not tell a working
    // translation from a missing one.
    expect(screen.getByPlaceholderText("Filter assets…")).toBeDefined();
  });
});
