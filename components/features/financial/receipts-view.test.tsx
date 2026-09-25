import { beforeEach, describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders as render,
  screen,
  waitFor,
} from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import { ReceiptsView } from "./receipts-view";

// Shared with the mocks below, so a test can choose the receipts and see what the screen did.
const { app, toast } = vi.hoisted(() => ({
  app: {
    receipts: [] as unknown[],
    deleteReceipt: vi.fn(async (_id: string) => {}),
    refreshData: vi.fn(async () => {}),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock the currency hook
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: { receipts: app.receipts, tenants: [], properties: [], loading: false },
    addReceipt: vi.fn(),
    updateReceipt: vi.fn(),
    deleteReceipt: app.deleteReceipt,
    refreshData: app.refreshData,
  }),
}));

vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));

describe("ReceiptsView", () => {
  it("renders empty receipts state", () => {
    app.receipts = [];
    render(<ReceiptsView />);
    expect(screen.getAllByText("Receipts").length).toBeGreaterThan(0);
  });
});

/**
 * Deleting a receipt takes its payment off the rent ledger (`receiptService.delete`), so the
 * confirmation has to say so. A receipt already submitted to Finanças is kept, and the screen says
 * why rather than letting the route answer with a generic conflict. In Portuguese: asserting
 * English cannot catch hardcoded English.
 */
describe("ReceiptsView: deleting a receipt", () => {
  const pt = ptMessages.financial.receipts;
  const receipt = (lifecycle: string) => ({
    id: "rec-1",
    userId: "user-1",
    tenantId: "tenant-1",
    tenantName: "Ana Costa",
    propertyId: "prop-1",
    propertyName: "Rua Augusta 12",
    amount: 950,
    date: "2026-03-01",
    type: "rent",
    status: "paid",
    lifecycle,
    createdAt: "2026-03-01",
    updatedAt: "2026-03-01",
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const chooseDelete = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: pt.options }));
    await user.click(await screen.findByRole("menuitem", { name: pt.delete }));
  };

  it("says the month goes back to unpaid, then deletes and reloads the ledger", async () => {
    app.receipts = [receipt("emitted")];
    const user = userEvent.setup();
    render(<ReceiptsView />, { initialLocale: "pt" });

    await chooseDelete(user);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(pt.deleteDialog.description);
    // The open dialog hides the rest of the page, so this is the dialog's own button.
    await user.click(screen.getByRole("button", { name: pt.deleteDialog.confirmLabel }));

    await waitFor(() => expect(app.refreshData).toHaveBeenCalledTimes(1));
    expect(app.deleteReceipt).toHaveBeenCalledWith("rec-1");
    expect(toast.success).toHaveBeenCalledWith(pt.toastDeleted);
  });

  it("keeps a receipt submitted to Finanças, and says why", async () => {
    app.receipts = [receipt("submitted")];
    const user = userEvent.setup();
    render(<ReceiptsView />, { initialLocale: "pt" });

    await chooseDelete(user);

    expect(toast.error).toHaveBeenCalledWith(pt.deleteFiled);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(app.deleteReceipt).not.toHaveBeenCalled();
  });
});
