import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import { TenancySheet } from "./tenancy-sheet";

const { app, toast } = vi.hoisted(() => ({
  app: {
    addTenant: vi.fn(async (data: Record<string, unknown>) => ({ id: "tenant-new", ...data })),
    addLease: vi.fn(async (data: Record<string, unknown>) => ({ id: "lease-new", ...data })),
    updateLease: vi.fn(async (id: string, data: Record<string, unknown>) => ({ id, ...data })),
    refreshData: vi.fn(async () => {}),
    tenants: [] as Record<string, unknown>[],
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      properties: [
        { id: "prop-1", name: "Rua Augusta 12", address: "Rua Augusta 12, Lisboa", rent: 850 },
      ],
      tenants: app.tenants,
    },
    addTenant: app.addTenant,
    addLease: app.addLease,
    updateLease: app.updateLease,
    refreshData: app.refreshData,
  }),
}));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));

const pt = ptMessages.leases.sheet;

beforeAll(() => {
  // Radix measures its popovers; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

/**
 * A tenancy used to take the tenant form, then a four-step lease wizard that could not create the
 * tenant, and the property page's "Add tenant" made a person with no lease. One sheet now makes
 * both, with the property's rent, a one-year term and a one-month deposit already filled in.
 */
describe("TenancySheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    app.tenants = [];
  });

  it("creates the tenant and their lease from one sheet, on the defaults", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <TenancySheet open onOpenChange={onOpenChange} prefill={{ propertyId: "prop-1" }} />,
      { initialLocale: "pt" },
    );

    expect(screen.getByLabelText(/Renda mensal/)).toHaveValue(850);
    expect(screen.getByLabelText(/Caução/)).toHaveValue(850);

    await user.type(screen.getByPlaceholderText(pt.namePlaceholder), "Ana Costa");
    await user.type(screen.getByLabelText("NIF"), "123456789");
    await user.click(screen.getByRole("button", { name: pt.submit }));

    await waitFor(() => expect(app.addLease).toHaveBeenCalledTimes(1));
    expect(app.addTenant).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Ana Costa", taxId: "123456789", email: null }),
    );
    expect(app.addLease).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-new",
        propertyId: "prop-1",
        monthlyRent: 850,
        deposit: 850,
        status: "active",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(pt.created);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says in Portuguese what is missing, and saves nothing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TenancySheet open onOpenChange={vi.fn()} />, { initialLocale: "pt" });

    await user.click(screen.getByRole("button", { name: pt.submit }));

    expect(screen.getByText(pt.error.property)).toBeInTheDocument();
    expect(screen.getByText(pt.error.name)).toBeInTheDocument();
    expect(screen.getByText(pt.error.rent)).toBeInTheDocument();
    expect(app.addTenant).not.toHaveBeenCalled();
    expect(app.addLease).not.toHaveBeenCalled();
  });

  it("does not add the tenant twice when the lease fails and the owner tries again", async () => {
    app.addLease.mockRejectedValueOnce(new Error("boom"));
    const user = userEvent.setup();
    renderWithProviders(
      <TenancySheet open onOpenChange={vi.fn()} prefill={{ propertyId: "prop-1" }} />,
      { initialLocale: "pt" },
    );

    await user.type(screen.getByPlaceholderText(pt.namePlaceholder), "Ana Costa");
    await user.click(screen.getByRole("button", { name: pt.submit }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(pt.error.saveFailed));

    await user.click(screen.getByRole("button", { name: pt.submit }));

    await waitFor(() => expect(app.addLease).toHaveBeenCalledTimes(2));
    expect(app.addTenant).toHaveBeenCalledTimes(1);
    expect(app.addLease).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId: "tenant-new" }),
    );
  });

  it("offers the tenants already on file", async () => {
    app.tenants = [{ id: "tenant-1", name: "Rui Silva", email: "rui@example.pt" }];
    const user = userEvent.setup();
    renderWithProviders(<TenancySheet open onOpenChange={vi.fn()} />, { initialLocale: "pt" });

    await user.click(screen.getByRole("button", { name: pt.pickExisting }));

    expect(screen.queryByPlaceholderText(pt.namePlaceholder)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: pt.typeNew })).toBeInTheDocument();
  });
});
