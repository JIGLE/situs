import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import { SettingsSecurity } from "./settings-security";

/**
 * The authenticator-app panel and the three routes behind it.
 *
 * `/api/auth/**` is public to the proxy, so `setup`, `enable` and `disable` check the CSRF token
 * themselves (`app/api/auth/totp/management.test.ts`). `setup` used to be a GET with no token, and
 * nothing here asked how the panel called it. Portuguese, so copy that is hardcoded English shows.
 */

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/lib/contexts/csrf-context", () => ({
  useCsrf: () => ({ token: "csrf-abc", isLoading: false, error: null, refreshToken: vi.fn() }),
}));

type Answer = { ok: boolean; status?: number; body?: unknown };

describe("SettingsSecurity — authenticator app", () => {
  let answers: Record<string, Answer>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    answers = {
      "/api/auth/totp/status": { ok: true, body: { totpEnabled: false } },
      "/api/auth/totp/setup": {
        ok: true,
        body: { secret: "JBSWY3DPEHPK3PXP", qrDataUrl: "data:image/png;base64,AAAA", otpauth: "x" },
      },
      "/api/auth/totp/enable": { ok: true, body: { backupCodes: ["AAAA1111", "BBBB2222"] } },
      "/api/auth/totp/disable": { ok: true, body: { ok: true } },
    };
    fetchMock = vi.fn(async (url: string) => {
      const answer = answers[url] ?? { ok: false, status: 404 };
      return { ok: answer.ok, status: answer.status ?? 200, json: async () => answer.body };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const callsTo = (url: string) => fetchMock.mock.calls.filter(([called]) => called === url);
  const renderPanel = () => render(<SettingsSecurity />, { initialLocale: "pt" });

  it("sets it up with a POST that carries the CSRF token, and shows the secret", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Configurar 2FA" }));

    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeDefined();
    expect(screen.getByAltText("Código QR de dois fatores")).toBeDefined();
    expect(callsTo("/api/auth/totp/setup")).toEqual([
      ["/api/auth/totp/setup", { method: "POST", headers: { "X-CSRF-Token": "csrf-abc" } }],
    ]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says so, and shows no secret, when setup is refused", async () => {
    answers["/api/auth/totp/setup"] = {
      ok: false,
      status: 409,
      body: { reason: "totp_already_enabled" },
    };
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Configurar 2FA" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Não foi possível ativar a autenticação de dois fatores.",
      ),
    );
    expect(screen.queryByAltText("Código QR de dois fatores")).toBeNull();
  });

  it("confirms the code with a POST that carries the token", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Configurar 2FA" }));
    fireEvent.change(await screen.findByLabelText("Código de verificação"), {
      target: { value: "123456" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Ativar 2FA" }));

    await waitFor(() => expect(callsTo("/api/auth/totp/enable")).toHaveLength(1));
    expect(callsTo("/api/auth/totp/enable")[0]).toEqual([
      "/api/auth/totp/enable",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-abc" },
        body: JSON.stringify({ code: "123456" }),
      },
    ]);
    expect(await screen.findByText("AAAA1111")).toBeDefined();
  });

  it("turns it off with a DELETE that carries the token", async () => {
    answers["/api/auth/totp/status"] = { ok: true, body: { totpEnabled: true } };
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Desativar 2FA" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Autenticação de dois fatores desativada"),
    );
    expect(callsTo("/api/auth/totp/disable")).toEqual([
      ["/api/auth/totp/disable", { method: "DELETE", headers: { "X-CSRF-Token": "csrf-abc" } }],
    ]);
  });
});
