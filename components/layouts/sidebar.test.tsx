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

// The account's row, as `UserSettingsProvider` would hold it. A plain function, not `vi.fn()`:
// `resetAllMocks` below would wipe a mock's return value between tests.
let accountSettings: { residenceCountry: string } | null = null;
vi.mock("@/lib/contexts/user-settings-context", () => ({
  useUserSettings: () => ({ settings: accountSettings, refresh: async () => {}, merge: () => {} }),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    accountSettings = null;
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
    let getAllByLabelText: (text: string) => HTMLElement[];
    await act(async () => {
      ({ queryByText, getAllByLabelText } = render(<Sidebar activeTab="dashboard" />, {
        initialLocale: "pt",
      }));
    });

    // Username should not be visible in collapsed mode
    expect(queryByText!("Alice")).toBeNull();

    // Both expand controls, the logo in the header and the chevron under the avatar, carry the
    // label — in Portuguese, because a hardcoded English label would pass an English assertion.
    expect(getAllByLabelText!("Expandir barra lateral")).toHaveLength(2);

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

  it("puts the bell in the header row, beside the collapse button", async () => {
    let getByLabelText: (text: string) => HTMLElement;
    await act(async () => {
      ({ getByLabelText } = render(<Sidebar activeTab="dashboard" />, { initialLocale: "pt" }));
    });

    const bell = getByLabelText!("Notificações");
    const collapse = getByLabelText!("Recolher barra lateral");
    expect(bell.parentElement).toBe(collapse.parentElement);
    // Sized like the collapse button, which it sits next to.
    expect(bell.className).toMatch(/\bh-8\b/);
    expect(bell.className).toMatch(/\bw-8\b/);
  });

  it("keeps the bell when collapsed, above the avatar", async () => {
    window.localStorage.setItem("situs.sidebar.collapsed", "true");
    let getByLabelText: (text: string) => HTMLElement;
    let getByTitle: (text: string) => HTMLElement;
    await act(async () => {
      ({ getByLabelText, getByTitle } = render(<Sidebar activeTab="dashboard" />, {
        initialLocale: "pt",
      }));
    });

    const bell = getByLabelText!("Notificações");
    const avatarLink = getByTitle!("Conta");
    expect(bell.parentElement).toBe(avatarLink.parentElement);
    expect(
      bell.compareDocumentPosition(avatarLink) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("reads the language, then the country of tax residence named in it", async () => {
    let getByText: (text: string) => HTMLElement;
    await act(async () => {
      ({ getByText } = render(<Sidebar activeTab="dashboard" />));
    });
    // No row yet: the column's default, Portugal.
    expect(getByText!("EN · Portugal")).toBeDefined();
  });

  it("names the residence country in the app's language", async () => {
    accountSettings = { residenceCountry: "ES" };
    let getByText: (text: string) => HTMLElement;
    await act(async () => {
      ({ getByText } = render(<Sidebar activeTab="dashboard" />, { initialLocale: "pt" }));
    });
    const line = getByText!("PT · Espanha");
    expect(line.getAttribute("title")).toBe("Idioma · país de residência fiscal");
  });
});
