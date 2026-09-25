import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import { LeasesView } from "./leases-view";

const { app, nav } = vi.hoisted(() => {
  const nav = {
    search: "",
    params: new URLSearchParams(),
    push: vi.fn(),
    // The real router clears the query, which is what stops the effect reopening the wizard.
    replace: vi.fn(() => {
      nav.search = "";
    }),
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

  it("starts a new lease for the tenant the link names, on their property", async () => {
    nav.search = "action=create&tenantId=tenant-1";
    const user = userEvent.setup();
    renderWithProviders(<LeasesView />, { initialLocale: "pt" });

    await screen.findByRole("dialog");
    expect(screen.getByRole("combobox")).toHaveTextContent("Rua Augusta 12");
    expect(nav.replace).toHaveBeenCalledWith("/leases");

    // The wizard's own Continue, the last one: the prefilled form also raises the "draft found"
    // banner above it, whose restore button shares the label.
    const continues = screen.getAllByRole("button", { name: ptMessages.actions.continue });
    await user.click(continues[continues.length - 1]);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("Ana Costa"));
  });
});
