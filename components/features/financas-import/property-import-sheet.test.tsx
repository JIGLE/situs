import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import type { PropertyDraft } from "@/lib/services/financas-import/caderneta";
import { PropertyImportSheet } from "./property-import-sheet";

const { app, toast, readCaderneta, apiFetch } = vi.hoisted(() => ({
  app: { refreshData: vi.fn(async () => {}) },
  toast: { success: vi.fn(), error: vi.fn() },
  readCaderneta: vi.fn(),
  apiFetch: vi.fn(async () => ({ id: "new" })),
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      properties: [{ id: "p1", name: "Loja da rua", cadasterReference: "374", fraction: "LJ B" }],
    },
    refreshData: app.refreshData,
  }),
}));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/lib/utils/api-client", () => ({ apiFetch, csrfHeaders: () => ({}) }));
vi.mock("./read-document", async (original) => ({
  ...(await original<typeof import("./read-document")>()),
  readCaderneta,
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const draft = (over: Partial<PropertyDraft>): PropertyDraft => ({
  name: "Rua Capitão Leitão 9, 2º ES",
  address: "Rua Capitão Leitão 9, 2º ES, 2800-051 Almada",
  streetAddress: "Rua Capitão Leitão 9",
  city: "Almada",
  zipCode: "2800-051",
  type: "apartment",
  bedrooms: 3,
  cadasterReference: "374",
  fraction: "2º ES",
  use: "Habitação",
  area: 98.2,
  ...over,
});

const t = ptMessages.financasImport;

/**
 * Properties from the cadernetas the Portal das Finanças gives as PDFs: read, shown for the owner
 * to check, and created only when ticked. One already in Situs starts unticked.
 */
describe("PropertyImportSheet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the units the owner keeps ticked, and leaves out one already there", async () => {
    readCaderneta.mockResolvedValueOnce({
      document: { kind: "urbana", article: "374" },
      drafts: [draft({ name: "Loja", fraction: "LJ B", type: "commercial" }), draft({})],
    });
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<PropertyImportSheet open onOpenChange={onOpenChange} />, {
      initialLocale: "pt",
    });

    await user.upload(
      screen.getByLabelText(t.choose),
      new File(["%PDF-1.7"], "caderneta.pdf", { type: "application/pdf" }),
    );

    await screen.findByText(t.alreadyHave.replace("{name}", "Loja da rua"));
    await user.click(screen.getByRole("button", { name: "Criar 1 imóvel" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (apiFetch.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(body).toMatchObject({
      name: "Rua Capitão Leitão 9, 2º ES",
      zipCode: "2800-051",
      type: "apartment",
      bedrooms: 3,
      rent: 0,
      status: "vacant",
      cadasterReference: "374",
      fraction: "2º ES",
    });
    expect(app.refreshData).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("1 imóvel criado");
  });

  it("says why a file could not be used", async () => {
    readCaderneta
      .mockResolvedValueOnce({ document: { kind: "rustica", article: "12" }, drafts: [] })
      .mockRejectedValueOnce(Object.assign(new Error("x"), { status: 422 }));
    const user = userEvent.setup();
    renderWithProviders(<PropertyImportSheet open onOpenChange={vi.fn()} />, {
      initialLocale: "pt",
    });

    await user.upload(screen.getByLabelText(t.choose), [
      new File(["%PDF"], "terreno.pdf", { type: "application/pdf" }),
      new File(["%PDF"], "scan.pdf", { type: "application/pdf" }),
    ]);

    expect(
      await screen.findByText((text: string) => text.includes(t.failure.rustica)),
    ).toBeInTheDocument();
    expect(screen.getByText((text: string) => text.includes(t.failure.noText))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criar imóveis" })).toBeDisabled();
  });
});
