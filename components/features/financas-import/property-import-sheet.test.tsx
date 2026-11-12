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
      owners: [{ id: "o1", name: "José Exemplo", taxIdentificationNumber: "123456789" }],
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
      document: {
        kind: "urbana",
        article: "374",
        holders: [
          { taxId: "123456789", name: "JOSÉ EXEMPLO", share: "1/2", kind: "full" },
          { taxId: "287654320", name: "ANA DA SILVA", share: "1/2", kind: "full" },
        ],
      },
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
    expect(
      screen.getAllByText(t.owners.replace("{list}", "José Exemplo 50% · Ana da Silva 50%")),
    ).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Criar 1 imóvel" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    // The property, then its owners: José is known, Ana is added first.
    const calls = (apiFetch.mock.calls as unknown as [string, { body: string }][]).map(
      ([url, init]) => [url, JSON.parse(init.body)],
    );
    expect(calls.map(([url]) => url)).toEqual([
      "/api/properties",
      "/api/property-owners",
      "/api/owners",
      "/api/property-owners",
    ]);
    expect(calls[1][1]).toEqual({ propertyId: "new", ownerId: "o1", ownershipPercentage: 50 });
    expect(calls[2][1]).toEqual({ name: "Ana da Silva", taxIdentificationNumber: "287654320" });
    expect(calls[3][1]).toEqual({ propertyId: "new", ownerId: "new", ownershipPercentage: 50 });
    const body = calls[0][1];
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
