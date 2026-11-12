import { beforeEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import { SettingsData } from "./settings-data";

/**
 * Settings › My data: the account's activity, and deleting the account. Portuguese, so copy that is
 * hardcoded English shows.
 */

const { toast, signOut, updateSession } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  signOut: vi.fn(),
  updateSession: vi.fn(),
}));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("next-auth/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth/react")>()),
  signOut,
  useSession: () => ({ update: updateSession, status: "authenticated", data: null }),
}));
vi.mock("@/lib/contexts/csrf-context", () => ({
  useCsrf: () => ({ token: "csrf-abc", isLoading: false, error: null, refreshToken: vi.fn() }),
}));

type Answer = { ok: boolean; status?: number; body?: unknown };

describe("SettingsData — the activity", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }) as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("loads the activity only when it is opened", async () => {
    render(<SettingsData />, { initialLocale: "pt" });

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

/**
 * Deleting the account: asked first, sent with the token, and when the instance cannot spare it (the
 * only administrator, while others remain) the owner is told why, in their own language, and stays.
 */
describe("SettingsData — deleting the account", () => {
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
    render(<SettingsData />, { initialLocale: "pt" });
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
