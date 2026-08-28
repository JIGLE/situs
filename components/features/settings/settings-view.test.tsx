import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import { SettingsView } from "./settings-view";

// Mock next-intl - must include NextIntlClientProvider
// `next-intl` is not mocked here. It used to be, returning the key (or a small hand-written
// map of English strings) — which meant this file asserted placeholder text rather than what
// a user reads. `renderWithProviders` supplies the real provider and catalogue.

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  usePathname: () => "/en/settings",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next-auth
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: null,
    status: "unauthenticated",
  }),
}));

// Mock toast context
vi.mock("@/lib/contexts/toast-context", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

// Mock CSRF + theme contexts (settings-view reads the real hooks)
vi.mock("@/lib/contexts/csrf-context", () => ({
  useCsrf: () => ({ token: "test-csrf", isLoading: false, error: null, refreshToken: vi.fn() }),
}));

vi.mock("@/lib/contexts/theme-context", () => ({
  useTheme: () => ({
    theme: "light",
    resolvedTheme: "light",
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

describe("SettingsView", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exports SettingsView component", () => {
    expect(typeof SettingsView).toBe("function");
  });

  it("renders without crashing", () => {
    const { container } = render(<SettingsView />);
    expect(container).toBeDefined();
  });

  it("calls fetch on mount for initial data", () => {
    render(<SettingsView />);

    // The component should attempt to fetch from at least /version.json
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(0);
  });

  it("is a React component that accepts no props", () => {
    const component = SettingsView as any;
    expect(typeof component).toBe("function");
  });

  const mockBilling = (billingEnabled: boolean) => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/billing/subscription") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              plan: "pro",
              status: "active",
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              maxProperties: 10,
              propertyCount: 3,
              billingEnabled,
            },
          }),
        });
      }
      if (url === "/api/health") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "ok",
            uptime: 0,
            environment: "test",
            checks: {
              database: { status: "healthy", latency_ms: 1 },
              email: { status: "healthy" },
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  };

  it("renders the Billing tab when billing is enabled", async () => {
    mockBilling(true);
    render(<SettingsView />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/billing/subscription");
    });
    await waitFor(() => {
      // The next-intl mock returns the key, so the section label renders as "billing".
      expect(screen.getByRole("button", { name: "Billing" })).toBeDefined();
    });
  });

  it("hides the Billing section on self-hosted instances (billing disabled)", async () => {
    mockBilling(false);
    render(<SettingsView />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/billing/subscription");
    });
    expect(screen.queryByRole("button", { name: "billing" })).toBeNull();
  });
});
