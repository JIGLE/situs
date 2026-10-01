import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import { markReported } from "@/lib/utils/api-error";
import type { Attention, AttentionItem } from "@/lib/services/attention/rules";
import { CompleteView } from "./complete-view";

/**
 * The guided list, in Portuguese: asserting English cannot catch copy that was never translated.
 * What is asked comes from `GET /api/attention` (`apiFetch` here); what is saved goes through the
 * record's own action (`useApp`), which has its own tests.
 */

const { apiFetch, updateLease, updateOwner, updateTenant } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  updateLease: vi.fn(),
  updateOwner: vi.fn(),
  updateTenant: vi.fn(),
}));

vi.mock("@/lib/utils/api-client", () => ({ apiFetch }));
vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({ updateLease, updateOwner, updateTenant }),
}));

function item(overrides: Partial<AttentionItem> & Pick<AttentionItem, "kind">): AttentionItem {
  const recordType = { contract_number: "lease", landlord_nif: "owner" } as const;
  const base = {
    contract_number: { type: "lease", id: "lease-1" },
    landlord_nif: { type: "owner", id: "owner-1" },
    tenant_nif: { type: "tenant", id: "tenant-1" },
    tenant_document: { type: "tenant", id: "tenant-1" },
  } as const;
  void recordType;
  return {
    id: `${overrides.kind}:${base[overrides.kind].id}`,
    weight: "blocks_receipt",
    record: base[overrides.kind],
    name: "Rui Silva",
    property: "T2 na Rua Augusta",
    problem: "missing",
    current: null,
    ...overrides,
  };
}

const answer = (items: AttentionItem[]): Attention => ({
  items,
  counts: { total: items.length, blocksReceipt: items.length, reminders: 0, niceToHave: 0 },
});

const CONTRACT = item({ kind: "contract_number" });
const LANDLORD = item({ kind: "landlord_nif", name: "Ana Costa" });
const TENANT = item({ kind: "tenant_nif" });

const input = () => screen.getByRole("textbox");
const saveButton = () => screen.getByRole("button", { name: /^(guardar|a guardar)/i });

beforeEach(() => {
  vi.clearAllMocks();
  updateLease.mockResolvedValue({});
  updateOwner.mockResolvedValue(undefined);
  updateTenant.mockResolvedValue(undefined);
});

describe("CompleteView", () => {
  it("asks one question, with what Situs knows, in Portuguese", async () => {
    apiFetch.mockResolvedValue(answer([CONTRACT, LANDLORD, TENANT]));

    render(<CompleteView />, { initialLocale: "pt" });

    expect(await screen.findByRole("heading", { name: "O que falta" })).toBeInTheDocument();
    expect(screen.getByTestId("complete-left")).toHaveTextContent("Faltam 3 dados");
    expect(screen.getByText("Necessário para emitir um recibo")).toBeInTheDocument();
    expect(screen.getByText("Contrato de Rui Silva, T2 na Rua Augusta")).toBeInTheDocument();
    expect(screen.getByLabelText("Número do contrato na AT")).toBeInTheDocument();
    expect(screen.getByText(/o número que a AT atribuiu ao contrato/i)).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/api/attention");
    expect(
      screen.queryByText(/what is missing|needed to issue|skip|save/i),
    ).not.toBeInTheDocument();
  });

  it("saves through the record's own action, then asks the next question", async () => {
    apiFetch
      .mockResolvedValueOnce(answer([CONTRACT, LANDLORD, TENANT]))
      .mockResolvedValueOnce(answer([LANDLORD, TENANT]));
    render(<CompleteView />, { initialLocale: "pt" });
    await screen.findByLabelText("Número do contrato na AT");

    fireEvent.change(input(), { target: { value: " 1234567 " } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(updateLease).toHaveBeenCalledWith("lease-1", { atContractNumber: "1234567" }),
    );
    expect(await screen.findByText("Ana Costa, senhorio de T2 na Rua Augusta")).toBeInTheDocument();
    expect(screen.getByTestId("complete-left")).toHaveTextContent("Faltam 2 dados");
    expect(input()).toHaveValue("");
  });

  it.each([
    [LANDLORD, updateOwner, "owner-1", { taxIdentificationNumber: "123456789" }, "NIF"],
    [TENANT, updateTenant, "tenant-1", { taxId: "123456789" }, "NIF"],
    [
      item({ kind: "tenant_document" }),
      updateTenant,
      "tenant-1",
      { idDocument: "123456789" },
      "Documento de identificação",
    ],
  ])("saves a %s.kind through its own action", async (subject, action, id, patch, label) => {
    apiFetch.mockResolvedValue(answer([subject]));
    render(<CompleteView />, { initialLocale: "pt" });
    await screen.findByLabelText(label);

    fireEvent.change(input(), { target: { value: "123456789" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(action).toHaveBeenCalledWith(id, patch));
  });

  it("holds Save until something is typed", async () => {
    apiFetch.mockResolvedValue(answer([CONTRACT]));
    render(<CompleteView />, { initialLocale: "pt" });
    await screen.findByLabelText("Número do contrato na AT");

    expect(saveButton()).toBeDisabled();
    fireEvent.change(input(), { target: { value: "   " } });
    expect(saveButton()).toBeDisabled();
    fireEvent.change(input(), { target: { value: "12" } });
    expect(saveButton()).toBeEnabled();
  });

  it("moves a skipped item behind the others, and says it comes back", async () => {
    apiFetch.mockResolvedValue(answer([CONTRACT, LANDLORD]));
    render(<CompleteView />, { initialLocale: "pt" });
    await screen.findByLabelText("Número do contrato na AT");

    fireEvent.click(screen.getByRole("button", { name: "Saltar" }));

    expect(await screen.findByText("Ana Costa, senhorio de T2 na Rua Augusta")).toBeInTheDocument();
    expect(screen.getByText("O que saltar volta no fim.")).toBeInTheDocument();
    // Skipping is not finishing: the count does not move.
    expect(screen.getByTestId("complete-left")).toHaveTextContent("Faltam 2 dados");

    fireEvent.click(screen.getByRole("button", { name: "Saltar" }));
    expect(await screen.findByText("Contrato de Rui Silva, T2 na Rua Augusta")).toBeInTheDocument();
  });

  it("offers no way to skip the last item", async () => {
    apiFetch.mockResolvedValue(answer([CONTRACT]));
    render(<CompleteView />, { initialLocale: "pt" });
    await screen.findByLabelText("Número do contrato na AT");

    expect(screen.queryByRole("button", { name: "Saltar" })).not.toBeInTheDocument();
    expect(screen.getByTestId("complete-left")).toHaveTextContent("Falta 1 dado");
  });

  it("offers a refused value back to be corrected, and says it is not valid", async () => {
    apiFetch.mockResolvedValue(
      answer([item({ kind: "landlord_nif", problem: "invalid", current: "123456780" })]),
    );
    render(<CompleteView />, { initialLocale: "pt" });

    expect(await screen.findByDisplayValue("123456780")).toBeInTheDocument();
    expect(screen.getByText("123456780 não é válido.")).toBeInTheDocument();
  });

  it("keeps the question when a save fails, and says why when the action did not", async () => {
    apiFetch.mockResolvedValue(answer([CONTRACT, LANDLORD]));
    updateLease.mockRejectedValue(Object.assign(new Error("boom"), { status: 400 }));
    render(<CompleteView />, { initialLocale: "pt" });
    await screen.findByLabelText("Número do contrato na AT");

    fireEvent.change(input(), { target: { value: "12" } });
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Contrato de Rui Silva, T2 na Rua Augusta")).toBeInTheDocument();
    expect(input()).toHaveValue("12");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not say it twice when the action already told the owner", async () => {
    apiFetch.mockResolvedValue(answer([CONTRACT, LANDLORD]));
    updateLease.mockRejectedValue(markReported(Object.assign(new Error("boom"), { status: 400 })));
    render(<CompleteView />, { initialLocale: "pt" });
    await screen.findByLabelText("Número do contrato na AT");

    fireEvent.change(input(), { target: { value: "12" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(updateLease).toHaveBeenCalled());
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says nothing is missing when the list is empty, and leads back to the dashboard", async () => {
    apiFetch.mockResolvedValue(answer([]));

    render(<CompleteView />, { initialLocale: "pt" });

    expect(await screen.findByText("Não falta nada")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar ao painel" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.queryByTestId("complete-left")).not.toBeInTheDocument();
  });

  it("says when the list could not be read, and reads it again on request", async () => {
    apiFetch.mockRejectedValueOnce(Object.assign(new Error("down"), { status: 500 }));
    apiFetch.mockResolvedValueOnce(answer([CONTRACT]));
    render(<CompleteView />, { initialLocale: "pt" });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByLabelText("Número do contrato na AT")).toBeInTheDocument();
  });
});
