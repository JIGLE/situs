import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import { MfaView } from "./mfa-view";

/**
 * The code page, in Portuguese: asserting English cannot catch copy that was never translated,
 * and this page used to be English whatever the language. It is the second step of every sign-in
 * for an account with an authenticator app, so what it shows and where it sends the user matter
 * more than they did when nothing led here.
 */

const { replace, update, signOut, session } = vi.hoisted(() => ({
  replace: vi.fn(),
  update: vi.fn(),
  signOut: vi.fn(),
  session: {
    current: { data: null, status: "loading" } as {
      data: { user: { id: string }; mfaPending?: boolean } | null;
      status: "loading" | "authenticated" | "unauthenticated";
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ ...session.current, update }),
  signOut,
}));
// It sets the language and has its own tests.
vi.mock("@/components/shared/language-selector", () => ({ LanguageSelector: () => null }));

const pending = () => {
  session.current = { data: { user: { id: "user-1" }, mfaPending: true }, status: "authenticated" };
};

const answer = (status: number, body: unknown = {}) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

const codeInput = () => screen.getByLabelText(/código/i);
const submit = () => screen.getByRole("button", { name: /^(verificar|a verificar)/i });

/** What `update` answers when the session was released: the session as the server now has it. */
const released = { user: { id: "user-1" }, mfaPending: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  session.current = { data: null, status: "loading" };
  update.mockResolvedValue(released);
});

describe("MfaView", () => {
  it("asks for the code in Portuguese, and says nothing in English", () => {
    pending();

    render(<MfaView />, { initialLocale: "pt" });

    expect(screen.getByRole("heading", { name: "Introduza o seu código" })).toBeInTheDocument();
    expect(screen.getByText("Autenticação de dois fatores")).toBeInTheDocument();
    expect(screen.getByLabelText("Código de autenticação")).toBeInTheDocument();
    expect(submit()).toHaveTextContent("Verificar");
    expect(screen.getByRole("button", { name: "Usar um código de recuperação" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Terminar sessão" })).toBeVisible();
    expect(screen.queryByText(/two-factor|verify|enter the/i)).not.toBeInTheDocument();
  });

  it("holds the button until the six digits are in", () => {
    pending();
    render(<MfaView />, { initialLocale: "pt" });

    expect(submit()).toBeDisabled();
    fireEvent.change(codeInput(), { target: { value: "12345" } });
    expect(submit()).toBeDisabled();
    fireEvent.change(codeInput(), { target: { value: "123 456" } });
    expect(submit()).toBeEnabled();
  });

  it("sends the code, gives the session the proof it is answered with, then goes to the app", async () => {
    pending();
    const fetchMock = answer(200, { ok: true, proof: "v1.1800000060000.mac" });
    vi.stubGlobal("fetch", fetchMock);
    render(<MfaView />, { initialLocale: "pt" });

    fireEvent.change(codeInput(), { target: { value: "123456" } });
    fireEvent.click(submit());

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/totp/verify",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "123456" }) }),
    );
    // The proof is what clears the session; a bare refresh would clear nothing.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ mfaProof: "v1.1800000060000.mac" });
    // It comes before the redirect: the proxy reads the cookie that update rewrites.
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0]);
  });

  it.each([
    ["null, which is what next-auth answers when the call failed", null],
    ["a session that is still held", { user: { id: "user-1" }, mfaPending: true }],
  ])(
    "does not leave when the update answers %s, since the proxy would send it straight back",
    async (_label, answerOfUpdate) => {
      pending();
      update.mockResolvedValue(answerOfUpdate);
      vi.stubGlobal("fetch", answer(200, { ok: true, proof: "v1.1800000060000.mac" }));
      render(<MfaView />, { initialLocale: "pt" });

      fireEvent.change(codeInput(), { target: { value: "123456" } });
      fireEvent.click(submit());

      expect(await screen.findByRole("alert")).toHaveTextContent("Algo correu mal. Tente de novo.");
      expect(replace).not.toHaveBeenCalled();
      expect(codeInput()).toHaveValue("");
    },
  );

  it("does not leave when the answer carries no proof, since the session would still be held", async () => {
    pending();
    vi.stubGlobal("fetch", answer(200, { ok: true }));
    render(<MfaView />, { initialLocale: "pt" });

    fireEvent.change(codeInput(), { target: { value: "123456" } });
    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("Algo correu mal. Tente de novo.");
    expect(update).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("says a wrong code is wrong in Portuguese, never in the server's English, and clears it", async () => {
    pending();
    vi.stubGlobal("fetch", answer(400, { error: "Invalid code" }));
    render(<MfaView />, { initialLocale: "pt" });

    fireEvent.change(codeInput(), { target: { value: "000000" } });
    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("Esse código não está certo.");
    expect(screen.queryByText(/invalid code/i)).not.toBeInTheDocument();
    expect(codeInput()).toHaveValue("");
    expect(replace).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("says when there have been too many attempts", async () => {
    pending();
    vi.stubGlobal("fetch", answer(429, { error: "Too many requests" }));
    render(<MfaView />, { initialLocale: "pt" });

    fireEvent.change(codeInput(), { target: { value: "000000" } });
    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Demasiadas tentativas. Aguarde um momento e tente de novo.",
    );
  });

  it("says something went wrong when the server could not be reached", async () => {
    pending();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    render(<MfaView />, { initialLocale: "pt" });

    fireEvent.change(codeInput(), { target: { value: "000000" } });
    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("Algo correu mal. Tente de novo.");
  });

  it("takes a backup code, eight characters, instead", () => {
    pending();
    render(<MfaView />, { initialLocale: "pt" });

    fireEvent.click(screen.getByRole("button", { name: "Usar um código de recuperação" }));

    expect(screen.getByLabelText("Código de recuperação")).toHaveAttribute("maxlength", "8");
    expect(screen.getByText(/cada um funciona uma vez/i)).toBeVisible();
    fireEvent.change(codeInput(), { target: { value: "ABCD1234" } });
    expect(submit()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Usar a aplicação autenticadora" })).toBeVisible();
  });

  it("lets the user out: signing out is the way back to the sign-in page", () => {
    pending();
    render(<MfaView />, { initialLocale: "pt" });

    fireEvent.click(screen.getByRole("button", { name: "Terminar sessão" }));

    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/auth/signin" });
  });

  it("sends someone who is not signed in to sign in", () => {
    session.current = { data: null, status: "unauthenticated" };

    render(<MfaView />, { initialLocale: "pt" });

    expect(replace).toHaveBeenCalledWith("/auth/signin");
    expect(screen.queryByLabelText(/código/i)).not.toBeInTheDocument();
  });

  it("sends someone with nothing pending to the app, without showing the form", () => {
    session.current = {
      data: { user: { id: "user-1" }, mfaPending: false },
      status: "authenticated",
    };

    render(<MfaView />, { initialLocale: "pt" });

    expect(replace).toHaveBeenCalledWith("/dashboard");
    expect(screen.queryByLabelText(/código/i)).not.toBeInTheDocument();
  });
});
