import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import { SettingsAccount } from "./settings-account";
import { defaultSettings } from "./settings-types";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { name: "Ana Lopes", email: "ana@example.com" } },
    status: "authenticated",
  }),
}));

describe("SettingsAccount", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }) as Response);
    global.fetch = fetchMock as typeof fetch;
  });

  const renderAccount = () =>
    render(
      <SettingsAccount appVersion="9.9.9" settings={defaultSettings} updateSetting={vi.fn()} />,
      { initialLocale: "pt" },
    );

  it("has no Sessions or API tokens card: neither feature exists", () => {
    renderAccount();

    expect(screen.queryByText("Sessões")).toBeNull();
    expect(screen.queryByText("Tokens de API")).toBeNull();
    // What the section is for is still there.
    expect(screen.getByText("ana@example.com")).toBeDefined();
  });

  it("loads the activity only when it is opened", async () => {
    renderAccount();

    const toggle = screen.getByRole("button", { name: "Atividade da conta" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/audit-trail"))).toBe(
      false,
    );

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/audit-trail"))).toBe(
        true,
      ),
    );
    expect(
      await screen.findByText(
        "Os inícios de sessão, exportações e alterações às definições aparecerão aqui.",
      ),
    ).toBeDefined();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
