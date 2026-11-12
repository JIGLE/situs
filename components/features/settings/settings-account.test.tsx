import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
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
  beforeEach(() => {
    global.fetch = vi.fn(
      async () => ({ ok: true, json: async () => ({ data: [] }) }) as Response,
    ) as typeof fetch;
  });

  const renderAccount = () =>
    render(<SettingsAccount settings={defaultSettings} updateSetting={vi.fn()} />, {
      initialLocale: "pt",
    });

  it("has no Sessions or API tokens card: neither feature exists", () => {
    renderAccount();

    expect(screen.queryByText("Sessões")).toBeNull();
    expect(screen.queryByText("Tokens de API")).toBeNull();
    // What the section is for is still there.
    expect(screen.getByText("ana@example.com")).toBeDefined();
  });
});
