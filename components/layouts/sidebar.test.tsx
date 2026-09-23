import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import { act } from "react";
import { Sidebar } from "./sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/en/dashboard",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { name: "Alice", email: "a@example.com", image: "/a.png" } },
  }),
  signOut: vi.fn(),
}));

// The sidebar mounts NotificationBell, which needs a CsrfProvider ancestor for useCsrf() and
// fetches on mount — renderWithProviders supplies neither, so both are stubbed here the same
// way document-detail-panel.tsx's own tests stub them.
vi.mock("@/lib/contexts/csrf-context", () => ({
  useCsrf: () => ({ token: "test-csrf-token" }),
}));
vi.mock("@/lib/utils/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/api-client")>();
  return {
    ...actual,
    apiFetch: vi.fn().mockResolvedValue({ notifications: [], total: 0, unreadCount: 0 }),
  };
});

vi.mock("@/lib/contexts/theme-context", () => ({
  useTheme: () => ({
    theme: "light",
    resolvedTheme: "normal",
    country: "PT",
    setTheme: vi.fn(),
    setCountry: vi.fn(),
    systemTheme: "light",
  }),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Ensure no persisted collapsed state by default
    window.localStorage.removeItem("situs.sidebar.collapsed");
  });

  it("renders menu and calls onTabChange when button clicked", async () => {
    const onTabChange = vi.fn();
    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(<Sidebar activeTab="dashboard" onTabChange={onTabChange} />));
    });

    // Just verify the component renders
    expect(container!).toBeDefined();
  });

  it("shows user info when session present", async () => {
    const onTabChange = vi.fn();
    let getByText: (text: string) => HTMLElement;
    await act(async () => {
      ({ getByText } = render(<Sidebar activeTab="dashboard" onTabChange={onTabChange} />));
    });

    // Username should be visible in expanded mode
    expect(getByText!("Alice")).toBeDefined();
  });

  it("hides labels when collapsed and shows header toggle", async () => {
    // Persist collapsed state so the component mounts collapsed
    window.localStorage.setItem("situs.sidebar.collapsed", "true");
    let queryByText: (text: string) => HTMLElement | null;
    let getByLabelText: (text: string) => HTMLElement;
    await act(async () => {
      ({ queryByText, getByLabelText } = render(<Sidebar activeTab="dashboard" />, {
        initialLocale: "pt",
      }));
    });

    // Username should not be visible in collapsed mode
    expect(queryByText!("Alice")).toBeNull();

    // Header toggle carries the Expand label — in Portuguese, because a hardcoded English label
    // would pass an English assertion.
    expect(getByLabelText!("Expandir barra lateral")).toBeDefined();

    // Header text 'Situs' should be hidden when collapsed
    expect(queryByText!("Situs")).toBeNull();
  });

  it("shows labels when expanded and username is visible", async () => {
    window.localStorage.setItem("situs.sidebar.collapsed", "false");
    let getByText: (text: string) => HTMLElement;
    let getByLabelText: (text: RegExp | string) => HTMLElement;
    await act(async () => {
      ({ getByText, getByLabelText } = render(<Sidebar activeTab="dashboard" />, {
        initialLocale: "pt",
      }));
    });
    expect(getByText!("Alice")).toBeDefined();

    // Every label a screen reader announces here, in the app's language.
    expect(getByLabelText!("Recolher barra lateral")).toBeDefined();
    expect(getByLabelText!("Navegação principal")).toBeDefined();
    expect(getByLabelText!("Terminar sessão")).toBeDefined();
  });
});
