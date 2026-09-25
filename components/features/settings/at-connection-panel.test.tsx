import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/utils/api-client", () => ({ apiFetch: apiFetchMock }));
vi.mock("@/lib/contexts/csrf-context", () => ({ useCsrf: () => ({ token: "csrf-token" }) }));

import { AtConnectionPanel } from "./at-connection-panel";

/**
 * Asserted in Portuguese: an English assertion cannot tell a translated string from a hardcoded
 * one. The server never sends the password, so what matters here is that the screen never shows
 * one either, and that AT's answers are put into words rather than codes.
 */

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const view = (overrides: Record<string, unknown> = {}) => ({
  mode: "review",
  username: "555555555/1",
  passwordSet: true,
  credentialsUnreadable: false,
  files: {
    files: {
      cert: { state: "ok", path: "/run/secrets/at-cert.pem" },
      key: { state: "ok", path: "/run/secrets/at-key.pem" },
      authKey: { state: "unset" },
    },
    certificate: {
      subject: "555555555",
      validFrom: inDays(-300),
      validTo: inDays(65),
      daysLeft: 65,
    },
    keyMatches: true,
    ready: false,
  },
  ...overrides,
});

function answer(url: string, body: unknown) {
  apiFetchMock.mockImplementation(async (requested: string) => {
    if (requested === "/api/tax/connectors/at") return view();
    if (requested === url) return body;
    throw new Error(`unexpected ${requested}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiFetchMock.mockResolvedValue(view());
});

describe("AtConnectionPanel", () => {
  it("names each certificate file's state, and when the certificate runs out", async () => {
    renderWithProviders(<AtConnectionPanel />, { initialLocale: "pt" });

    expect(await screen.findByText("Certificado SSL")).toBeInTheDocument();
    expect(screen.getAllByText("Carregado")).toHaveLength(2);
    expect(screen.getByText("Não definido")).toBeInTheDocument();
    expect(screen.getByText(/NIF 555555555 · válido até .* · faltam 65 dias/)).toBeInTheDocument();
  });

  it("warns once the certificate is within 30 days of its end", async () => {
    apiFetchMock.mockResolvedValue(
      view({
        files: {
          ...view().files,
          certificate: { ...view().files.certificate, validTo: inDays(12), daysLeft: 12 },
        },
      }),
    );
    renderWithProviders(<AtConnectionPanel />, { initialLocale: "pt" });

    expect(await screen.findByText(/faltam 12 dias/)).toHaveClass(
      "text-[var(--semantic-warning-readable)]",
    );
  });

  it("never shows the stored password, and says one is stored", async () => {
    renderWithProviders(<AtConnectionPanel />, { initialLocale: "pt" });

    expect(await screen.findByLabelText("Senha")).toHaveValue("");
    expect(screen.getByText("Guardada. Escreva outra para a mudar.")).toBeInTheDocument();
    expect(screen.getByLabelText("Utilizador (NIF/subutilizador)")).toHaveValue("555555555/1");
  });

  it("sends a typed password once, then clears the field", async () => {
    const user = userEvent.setup();
    answer("/api/tax/connectors/at/credentials", view());
    renderWithProviders(<AtConnectionPanel />, { initialLocale: "pt" });

    await user.type(await screen.findByLabelText("Senha"), "nova-senha");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/tax/connectors/at/credentials",
        "csrf-token",
        "PUT",
        { username: "555555555/1", password: "nova-senha" },
      ),
    );
    expect(await screen.findByText("Guardado.")).toBeInTheDocument();
    expect(screen.getByLabelText("Senha")).toHaveValue("");
  });

  it("explains a malformed username and will not save it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AtConnectionPanel />, { initialLocale: "pt" });

    const field = await screen.findByLabelText("Utilizador (NIF/subutilizador)");
    await user.clear(field);
    await user.type(field, "555555555");

    expect(
      screen.getByText("Use o NIF, uma barra e o número do subutilizador, como 123456789/1."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("offers Check credentials only in the test mode", async () => {
    renderWithProviders(<AtConnectionPanel />, { initialLocale: "pt" });

    expect(await screen.findByRole("button", { name: "Verificar" })).toBeDisabled();
    expect(screen.getByText("Disponível no modo de testes.")).toBeInTheDocument();
  });

  it("reads AT's −1 on a check as the credentials accepted", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockImplementation(async (url: string) =>
      url === "/api/tax/connectors/at"
        ? view({ mode: "test" })
        : {
            outcome: "answer",
            code: -1,
            category: "rejected",
            message: "Não foi possível obter o recibo",
            errors: [],
          },
    );
    renderWithProviders(<AtConnectionPanel />, { initialLocale: "pt" });

    await user.click(await screen.findByRole("button", { name: "Verificar" }));

    expect(
      await screen.findByText("A AT aceitou o certificado e o subutilizador."),
    ).toBeInTheDocument();
  });

  it("puts a refused password into words, with AT's own message beside it", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockImplementation(async (url: string) =>
      url === "/api/tax/connectors/at"
        ? view({ mode: "test" })
        : {
            outcome: "answer",
            code: 99,
            category: "password",
            message: "Erro na validação da senha",
            errors: [],
          },
    );
    renderWithProviders(<AtConnectionPanel />, { initialLocale: "pt" });

    await user.click(await screen.findByRole("button", { name: "Verificar" }));

    expect(
      await screen.findByText("A AT recusou a senha, ou o acesso do subutilizador está suspenso."),
    ).toBeInTheDocument();
    expect(screen.getByText("Resposta da AT: Erro na validação da senha")).toBeInTheDocument();
  });

  it("says nothing was sent when AT could not be reached", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockImplementation(async (url: string) =>
      url === "/api/tax/connectors/at" ? view({ mode: "test" }) : { outcome: "not_sent" },
    );
    renderWithProviders(<AtConnectionPanel />, { initialLocale: "pt" });

    await user.click(await screen.findByRole("button", { name: "Verificar" }));

    expect(await screen.findByText(/por isso nada foi enviado/)).toBeInTheDocument();
  });

  it("says AT has no such receipt when a fetch finds none", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockImplementation(async (url: string) =>
      url === "/api/tax/connectors/at"
        ? view({ mode: "test" })
        : {
            call: {
              outcome: "answer",
              code: -1,
              category: "rejected",
              message: "Não foi possível obter o recibo",
              errors: [],
            },
          },
    );
    renderWithProviders(<AtConnectionPanel />, { initialLocale: "pt" });

    await user.type(await screen.findByLabelText("N.º do contrato"), "123456");
    await user.type(screen.getByLabelText("N.º do recibo"), "7");
    await user.click(screen.getByRole("button", { name: "Obter PDF" }));

    expect(await screen.findByText("A AT não tem esse recibo, ou não é seu.")).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/tax/connectors/at/receipt",
      "csrf-token",
      "POST",
      { contractNumber: 123456, receiptNumber: 7 },
    );
  });

  it("shows a refusal's reason in the owner's language", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tax/connectors/at") return view({ passwordSet: false, username: null });
      throw Object.assign(new Error("no key"), { status: 409, reason: "at_credentials_need_key" });
    });
    renderWithProviders(<AtConnectionPanel />, { initialLocale: "pt" });

    await user.type(await screen.findByLabelText("Utilizador (NIF/subutilizador)"), "555555555/1");
    await user.type(screen.getByLabelText("Senha"), "x");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText(/não tem PII_ENCRYPTION_KEY/)).toBeInTheDocument();
  });
});
