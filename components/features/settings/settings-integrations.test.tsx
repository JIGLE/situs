import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import { SettingsIntegrations } from "./settings-integrations";

// The URL the section opens with; each test sets its own.
let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

// Each tab's panel has its own tests; here they only need to be told apart.
vi.mock("./bank-connect-panel", () => ({ BankConnectPanel: () => <div>painel dos bancos</div> }));
vi.mock("./at-connection-panel", () => ({ AtConnectionPanel: () => <div>painel da AT</div> }));
vi.mock("@/lib/hooks/use-bank-connections", () => ({
  useBankConnections: () => ({
    connections: [],
    providersConfigured: [],
    loading: false,
    reload: async () => {},
  }),
}));

describe("SettingsIntegrations", () => {
  beforeEach(() => {
    search = "tab=integrations";
    window.history.replaceState(null, "", `/settings?${search}`);
  });

  it("opens on Bancos, with Finanças beside it and no classifier card", () => {
    render(<SettingsIntegrations />, { initialLocale: "pt" });

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab: HTMLElement) => tab.textContent)).toEqual(["Bancos", "Finanças"]);
    expect(screen.getByRole("tab", { name: "Bancos" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tablist", { name: "Integrações" })).toBeDefined();
    expect(screen.getByText("painel dos bancos")).toBeDefined();
    // The classifier it described was removed long ago.
    expect(screen.queryByText("Classificador simulado")).toBeNull();
  });

  it("opens Finanças from ?view=at, and keeps the chosen tab in the URL", () => {
    search = "tab=integrations&view=at";
    render(<SettingsIntegrations />, { initialLocale: "pt" });

    expect(screen.getByRole("tab", { name: "Finanças" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("painel da AT")).toBeDefined();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Bancos" }), { button: 0 });

    expect(screen.getByText("painel dos bancos")).toBeDefined();
    expect(new URLSearchParams(window.location.search).get("view")).toBe("banks");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("integrations");
  });
});
