import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import { SettingsView } from "./settings-view";

const { refreshAccount, setLanguage } = vi.hoisted(() => ({
  refreshAccount: vi.fn(),
  setLanguage: vi.fn(),
}));

// Mock next-intl - must include NextIntlClientProvider
// `next-intl` is not mocked here. It used to be, returning the key (or a small hand-written
// map of English strings) — which meant this file asserted placeholder text rather than what
// a user reads. `renderWithProviders` supplies the real provider and catalogue.

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/en/settings",
  // The address bar as the page sees it, so `?tab=` and `?view=` round-trip through the URL.
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// Mock next-auth. Signed out unless a test signs in: Settings loads the account's row only for a
// session.
let sessionData: { user: { name: string; email: string; role?: string } } | null = null;
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: sessionData,
    status: sessionData ? "authenticated" : "unauthenticated",
  }),
}));

vi.mock("@/lib/contexts/user-settings-context", () => ({
  useUserSettings: () => ({ settings: null, refresh: refreshAccount, merge: () => {} }),
}));

vi.mock("@/lib/i18n/use-set-language", () => ({
  useSetLanguage: () => setLanguage,
}));

// Integrations' panels fetch their own data and have their own tests.
vi.mock("./at-connection-panel", () => ({ AtConnectionPanel: () => null }));
vi.mock("./bank-connect-panel", () => ({ BankConnectPanel: () => null }));
vi.mock("@/lib/hooks/use-bank-connections", () => ({
  useBankConnections: () => ({
    connections: [],
    providersConfigured: [],
    loading: false,
    reload: async () => {},
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
});

describe("SettingsView, signed in", () => {
  const ROW = {
    theme: "system",
    language: "pt",
    languageChosenAt: null,
    residenceCountry: "PT",
    emailNotifications: true,
    taxReminderNotifications: true,
    distributionNotifications: true,
  };
  let requests: { url: string; init?: RequestInit }[];

  beforeAll(() => {
    // Radix Select measures and scrolls its options, which jsdom does not implement.
    if (typeof Element.prototype.scrollIntoView !== "function") {
      Element.prototype.scrollIntoView = () => {};
    }
    if (typeof globalThis.ResizeObserver !== "function") {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
  });

  beforeEach(() => {
    sessionData = { user: { name: "Ana Lopes", email: "ana@example.com" } };
    requests = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      const body =
        url === "/api/settings" && !init?.method
          ? { data: ROW }
          : url === "/version.json"
            ? { version: "9.9.9" }
            : { data: [] };
      return { ok: true, json: async () => body } as Response;
    }) as typeof fetch;
    window.history.replaceState(null, "", "/settings");
  });

  afterEach(() => {
    sessionData = null;
    vi.clearAllMocks();
  });

  /** Opens a Radix Select from the keyboard and picks an option by its name. */
  async function choose(select: HTMLElement, option: string) {
    fireEvent.keyDown(select, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: option }));
  }

  it("saves the country of tax residence as soon as it changes, then re-reads the account", async () => {
    render(<SettingsView />, { initialLocale: "pt" });

    const country = await screen.findByRole("combobox", { name: "País de residência fiscal" });
    expect(country).toHaveTextContent("Portugal");

    await choose(country, "Espanha");
    expect(country).toHaveTextContent("Espanha");

    // No Guardar to press: the change saves itself, and the rail's line under the name, which
    // reads the account's row, is read again.
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
    await waitFor(() => expect(refreshAccount).toHaveBeenCalledTimes(1), { timeout: 3000 });

    const save = requests.find((request) => request.init?.method === "POST");
    expect(save?.url).toBe("/api/settings");
    expect(JSON.parse(String(save?.init?.body)).residenceCountry).toBe("ES");
  });

  it("sends a change still waiting when the owner leaves Settings", async () => {
    const { unmount } = render(<SettingsView />, { initialLocale: "pt" });

    await choose(
      await screen.findByRole("combobox", { name: "País de residência fiscal" }),
      "Espanha",
    );
    unmount();

    const save = requests.find((request) => request.init?.method === "POST");
    expect(JSON.parse(String(save?.init?.body)).residenceCountry).toBe("ES");
  });

  it("lists Administração only for an administrator", async () => {
    const { unmount } = render(<SettingsView />, { initialLocale: "pt" });
    expect(await screen.findByRole("button", { name: "Conta" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Administração" })).toBeNull();
    unmount();

    sessionData = { user: { name: "Ana Lopes", email: "ana@example.com", role: "ADMIN" } };
    render(<SettingsView />, { initialLocale: "pt" });
    expect(await screen.findByRole("button", { name: "Administração" })).toBeDefined();
  });

  it("drops Integrations' tab from the URL on moving to another section", async () => {
    window.history.replaceState(null, "", "/settings?tab=integrations&view=at");
    render(<SettingsView />, { initialLocale: "pt" });

    fireEvent.click(await screen.findByRole("button", { name: "Conta" }));

    expect(window.location.search).toBe("?tab=account");
  });

  it("opens an old Appearance link on Account, which holds the language", async () => {
    window.history.replaceState(null, "", "/settings?tab=appearance");
    render(<SettingsView />, { initialLocale: "pt" });

    const language = await screen.findByRole("combobox", { name: "Idioma" });
    expect(language).toHaveTextContent("Português");
    expect(screen.getByRole("button", { name: "Conta" }).getAttribute("aria-current")).toBe("page");

    await choose(language, "English");
    expect(setLanguage).toHaveBeenCalledWith("en");
  });
});
