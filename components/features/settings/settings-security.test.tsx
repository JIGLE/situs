import { beforeEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import { SettingsSecurity } from "./settings-security";

/**
 * The authenticator-app panel and the three routes behind it.
 *
 * `/api/auth/**` is public to the proxy, so `setup`, `enable` and `disable` check the CSRF token
 * themselves (`app/api/auth/totp/management.test.ts`). `setup` used to be a GET with no token, and
 * nothing here asked how the panel called it. Portuguese, so copy that is hardcoded English shows.
 */

const { toast, signOut } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  signOut: vi.fn(),
}));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("next-auth/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth/react")>()),
  signOut,
}));
vi.mock("@/lib/contexts/csrf-context", () => ({
  useCsrf: () => ({ token: "csrf-abc", isLoading: false, error: null, refreshToken: vi.fn() }),
}));

type Answer = { ok: boolean; status?: number; body?: unknown };

const CHANGED_ELSEWHERE =
  "A autenticação de dois fatores foi alterada noutra janela. Recarregue a página e tente novamente.";

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

  it("shows what is true when another window has already turned it on", async () => {
    answers["/api/auth/totp/setup"] = {
      ok: false,
      status: 409,
      body: { reason: "totp_already_enabled" },
    };
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Configurar 2FA" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(CHANGED_ELSEWHERE));
    expect(await screen.findByRole("button", { name: "Desativar 2FA" })).toBeDefined();
    expect(screen.queryByAltText("Código QR de dois fatores")).toBeNull();
  });

  it("says it could not when setup fails for any other reason, and shows no secret", async () => {
    answers["/api/auth/totp/setup"] = { ok: false, status: 500, body: {} };
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Configurar 2FA" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Não foi possível ativar a autenticação de dois fatores.",
      ),
    );
    expect(screen.getByRole("button", { name: "Configurar 2FA" })).toBeDefined();
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

  it("goes back to the start when the setup changed in another window while confirming", async () => {
    answers["/api/auth/totp/enable"] = {
      ok: false,
      status: 409,
      body: { reason: "totp_setup_changed" },
    };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Configurar 2FA" }));
    fireEvent.change(await screen.findByLabelText("Código de verificação"), {
      target: { value: "123456" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Ativar 2FA" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(CHANGED_ELSEWHERE));
    expect(await screen.findByRole("button", { name: "Configurar 2FA" })).toBeDefined();
    expect(screen.queryByText("AAAA1111")).toBeNull();
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

/**
 * Deleting the account: asked first, sent with the token, and when the instance cannot spare it (the
 * only administrator, while others remain) the owner is told why, in their own language, and stays.
 */
describe("SettingsSecurity — deleting the account", () => {
  const panel = ptMessages.settings.panel;
  const api = ptMessages.errors.api;
  let answer: Answer;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    answer = { ok: true, body: { message: "Data deleted successfully" } };
    fetchMock = vi.fn(async (url: string) => {
      const answered = url === "/api/user/delete-data" ? answer : { ok: false, status: 404 };
      return { ok: answered.ok, status: answered.status ?? 200, json: async () => answered.body };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const deleteCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/api/user/delete-data");
  const openDialog = async () => {
    render(<SettingsSecurity />, { initialLocale: "pt" });
    fireEvent.click(await screen.findByRole("button", { name: panel.deleteTitle }));
    return await screen.findByRole("alertdialog");
  };
  const confirm = (dialog: HTMLElement) =>
    fireEvent.click(within(dialog).getByRole("button", { name: panel.deleteConfirmLabel }));

  it("asks first, and sends nothing until the owner confirms", async () => {
    const dialog = await openDialog();

    expect(within(dialog).getByText(panel.deleteConfirmTitle)).toBeDefined();
    expect(deleteCalls()).toHaveLength(0);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("deletes with a POST that carries the token, then ends the session and leaves for the sign-in page", async () => {
    confirm(await openDialog());

    // Its token would outlive the account for a day, and the sign-in page would send it on to the dashboard.
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/auth/signin" }));
    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0][1]).toMatchObject({
      method: "POST",
      headers: { "X-CSRF-Token": "csrf-abc" },
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("tells the only administrator why, in words, and stays where they are", async () => {
    answer = {
      ok: false,
      status: 409,
      body: { error: "The instance needs an administrator", reason: "last_admin" },
    };
    confirm(await openDialog());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(api.lastAdmin));
    expect(signOut).not.toHaveBeenCalled();
  });

  it("says the server failed, in Portuguese, for any other failure", async () => {
    answer = { ok: false, status: 500, body: { error: "Internal server error" } };
    confirm(await openDialog());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(api.serverError));
    expect(signOut).not.toHaveBeenCalled();
  });
});
