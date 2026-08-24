import { describe, it, expect, vi } from "vitest";
import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import { OverviewView } from "./overview-view";

// `next-intl` is not mocked here. It used to be, returning the key (or a small hand-written
// map of English strings) — which meant this file asserted placeholder text rather than what
// a user reads. `renderWithProviders` supplies the real provider and catalogue.

// Mock next-auth
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { name: "Test User", email: "test@test.com", id: "test-user-id" },
    },
    status: "authenticated",
  }),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock the currency hook
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      properties: [
        {
          id: "p1",
          name: "One",
          status: "occupied",
          bedrooms: 2,
          bathrooms: 1,
          rent: 1000,
        },
      ],
      tenants: [
        {
          id: "t1",
          name: "John",
          paymentStatus: "paid",
          rent: 1000,
          leaseStart: new Date().toISOString(),
          leaseEnd: new Date().toISOString(),
        },
      ],
      receipts: [
        {
          id: "r1",
          tenantName: "John",
          propertyName: "One",
          amount: 1000,
          status: "paid",
          type: "rent",
          date: new Date().toISOString(),
        },
      ],
      maintenance: [],
      leases: [],
      expenses: [],
      loading: false,
    },
    refreshData: vi.fn(),
  }),
}));

// Mock keyboard shortcuts hook
vi.mock("@/lib/hooks/use-keyboard-shortcuts", () => ({
  useKeyboardShortcuts: vi.fn(),
}));

describe("OverviewView", () => {
  it("renders dashboard overview and stats", () => {
    const { container } = render(<OverviewView />);
    // Just verify the component renders without crashing
    expect(container).toBeDefined();
  });
});
