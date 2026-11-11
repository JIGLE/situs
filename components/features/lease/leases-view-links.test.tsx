import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import { LeasesView } from "./leases-view";

const { app, nav } = vi.hoisted(() => {
  const nav = {
    search: "",
    params: new URLSearchParams(),
    push: vi.fn(),
    replace: vi.fn(),
  };
  return {
    nav,
    app: {
      addLease: vi.fn(),
      updateLease: vi.fn(),
      deleteLease: vi.fn(),
      refreshData: vi.fn(async () => {}),
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/leases",
  // One object per query, as Next's hook returns, so the effect runs when the query changes.
  useSearchParams: () => {
    if (nav.params.toString() !== nav.search) nav.params = new URLSearchParams(nav.search);
    return nav.params;
  },
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      leases: [],
      properties: [
        { id: "prop-1", name: "Rua Augusta 12", address: "Rua Augusta 12, Lisboa" },
        { id: "prop-2", name: "Rua do Ouro 3", address: "Rua do Ouro 3, Lisboa" },
      ],
      tenants: [
        { id: "tenant-1", name: "Ana Costa", email: "ana@example.pt", propertyId: "prop-1" },
        { id: "tenant-2", name: "Rui Silva", email: "rui@example.pt" },
      ],
      receipts: [],
      loading: false,
    },
    addLease: app.addLease,
    updateLease: app.updateLease,
    deleteLease: app.deleteLease,
    addTenant: vi.fn(),
    refreshData: app.refreshData,
  }),
}));

/**
 * The tenant modal's "Add lease" sends the owner to `/leases?action=create&tenantId=…`. The
 * screen only knew `edit` and `renew`, and returned early without an `id`, so the button landed
 * on the list and did nothing. It now opens a new lease with that tenant chosen, and the
 * tenant's property when they have one.
 */
describe("LeasesView: opened from a link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("starts a new tenancy for the tenant the link names, on their property", async () => {
    nav.search = "action=create&tenantId=tenant-1";
    window.history.replaceState(null, "", `/leases?${nav.search}`);
    renderWithProviders(<LeasesView />, { initialLocale: "pt" });

    await screen.findByRole("dialog");
    const [property, tenant] = screen.getAllByRole("combobox");
    expect(property).toHaveTextContent("Rua Augusta 12");
    expect(tenant).toHaveTextContent("Ana Costa");
    // The query stays while the sheet is open, so a screen that mounts afresh as the data loads
    // opens it again; it goes on closing, through the History API rather than a navigation.
    expect(window.location.search).toBe(`?${nav.search}`);
    await userEvent.setup().click(screen.getByRole("button", { name: ptMessages.actions.cancel }));
    expect(window.location.search).toBe("");
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
