import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import { LeasesView } from "./leases-view";

const { app, toast } = vi.hoisted(() => ({
  app: {
    leases: [] as unknown[],
    addLease: vi.fn(async (data: Record<string, unknown>) => ({ id: "lease-new", ...data })),
    updateLease: vi.fn(async (id: string, data: Record<string, unknown>) => ({ id, ...data })),
    deleteLease: vi.fn(),
    refreshData: vi.fn(async () => {}),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      leases: app.leases,
      properties: [{ id: "prop-1", name: "Rua Augusta 12", address: "Rua Augusta 12, Lisboa" }],
      tenants: [{ id: "tenant-1", name: "Ana Costa", email: "ana@example.pt" }],
      receipts: [],
      loading: false,
    },
    addLease: app.addLease,
    updateLease: app.updateLease,
    deleteLease: app.deleteLease,
    refreshData: app.refreshData,
  }),
}));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));

const pt = ptMessages.leases;

const ended = {
  id: "lease-1",
  userId: "user-1",
  propertyId: "prop-1",
  tenantId: "tenant-1",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  monthlyRent: 950,
  deposit: 1900,
  status: "terminated",
  autoRenew: false,
  renewalNoticeDays: 60,
  notes: "",
  tenant: { id: "tenant-1", name: "Ana Costa" },
  property: { id: "prop-1", name: "Rua Augusta 12" },
  parties: [],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

/**
 * The wizard saved every lease as `active`, new or edited, so correcting a note on a terminated
 * lease brought it back to life. Only a new lease starts active now; an edit sends no status, and
 * the update route leaves the stored one alone.
 */
describe("LeasesView: saving the lease wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("keeps an ended lease ended when it is edited", async () => {
    app.leases = [ended];
    const user = userEvent.setup();
    renderWithProviders(<LeasesView />, { initialLocale: "pt" });

    await user.click(screen.getByRole("button", { name: pt.field.actions }));
    await user.click(await screen.findByRole("menuitem", { name: pt.editLease }));
    for (let step = 0; step < 3; step++) {
      await user.click(await screen.findByRole("button", { name: ptMessages.actions.continue }));
    }
    await user.click(await screen.findByRole("button", { name: pt.submitUpdate }));

    await waitFor(() => expect(app.updateLease).toHaveBeenCalledTimes(1));
    const [id, sent] = app.updateLease.mock.calls[0];
    expect(id).toBe("lease-1");
    expect(sent).not.toHaveProperty("status");
    expect(sent).toMatchObject({ monthlyRent: 950, endDate: "2025-12-31" });
  });
});
