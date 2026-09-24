import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders as render,
  screen,
  waitFor,
} from "@/tests/helpers/render-with-providers";
import enMessages from "@/messages/en.json";
import ptMessages from "@/messages/pt.json";
import { FinancialsView } from "./financials-view";

// Shared with the mocks below, so a test can see what the screen asked the app and the toasts for.
const { app, toast } = vi.hoisted(() => ({
  app: {
    receipts: [] as unknown[],
    addExpense: vi.fn(),
    addReceipt: vi.fn(),
    refreshData: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock the currency hook
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number | undefined) =>
      amount !== undefined ? `$${amount.toFixed(2)}` : "$0.00",
    currencySymbol: "$",
  }),
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      properties: [],
      receipts: app.receipts,
      expenses: [],
      loading: false,
      metrics: {
        totalIncome: 0,
        totalExpenses: 0,
        netIncome: 0,
        filteredReceipts: [],
        filteredExpenses: [],
      },
    },
    addExpense: app.addExpense,
    addReceipt: app.addReceipt,
    refreshData: app.refreshData,
  }),
}));

vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));

vi.mock("@/lib/hooks/use-form-dialog", () => ({
  useFormDialog: () => ({
    isOpen: false,
    isSubmitting: false,
    isValidating: false,
    formData: {},
    formErrors: {},
    editingItem: null,
    hasUnsavedChanges: false,
    isSaving: false,
    lastSaved: null,
    hasPersistedData: false,
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    openEditDialog: vi.fn(),
    handleSubmit: vi.fn(),
    updateFormData: vi.fn(),
    setFormData: vi.fn(),
    resetForm: vi.fn(),
    validateField: vi.fn(),
    validateForm: vi.fn(),
    restoreForm: vi.fn(),
    clearPersistedData: vi.fn(),
    forceSave: vi.fn(),
  }),
}));

describe("FinancialsView", () => {
  /**
   * Assertions read the catalogue rather than repeating its English.
   *
   * This test used to expect the literal `/Accounts/` — and passed for as long as the view
   * hardcoded the word "Accounts", because a literal assertion against a literal render agrees
   * with itself. It was not neutral about the bug; it pinned it. Comparing against
   * `enMessages.financial.*` fails the moment rendered copy and catalogue disagree, and
   * `tests/i18n-no-hardcoded-copy.test.tsx` covers the case where they agree in English but the
   * component never asked the catalogue at all.
   */
  it("renders empty state when no data", () => {
    render(<FinancialsView />);
    expect(screen.getByRole("heading", { name: enMessages.financial.title })).toBeInTheDocument();
    expect(screen.getByText(enMessages.financial.noFinancialData)).toBeInTheDocument();
    expect(screen.getByText(enMessages.financial.noFinancialDataDesc)).toBeInTheDocument();
  });
});

describe("FinancialsView: generating this month's receipts", () => {
  const receipt = {
    id: "rec-0",
    userId: "user-1",
    tenantId: "tenant-1",
    tenantName: "Ana Costa",
    propertyId: "prop-1",
    propertyName: "Rua Augusta 12",
    amount: 950,
    date: "2026-02-01",
    type: "rent",
    status: "paid",
    createdAt: "2026-02-01",
    updatedAt: "2026-02-01",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Any receipt at all, so the screen renders past its empty state to the button.
    app.receipts = [receipt];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    app.receipts = [];
  });

  // The route writes and allocates every receipt it generates. The screen then handed each one to
  // `addReceipt`, which POSTs to /api/receipts and wrote it a second time: every generated month
  // was billed twice, in the list and in every total that sums receipts.
  it("reloads what the route wrote instead of writing it again", async () => {
    const generated = [
      { ...receipt, id: "rec-1" },
      { ...receipt, id: "rec-2" },
    ];
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { generated, skipped: 0, errors: [] } }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<FinancialsView />);

    await user.click(screen.getByRole("button", { name: enMessages.financial.bulkGenerate }));

    await waitFor(() => expect(app.refreshData).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/receipts/bulk",
      expect.objectContaining({ method: "POST" }),
    );
    expect(app.addReceipt).not.toHaveBeenCalled();
  });

  it("reports a failed run in the app's language, not the server's", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Database operation failed" }), { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    render(<FinancialsView />, { initialLocale: "pt" });

    await user.click(screen.getByRole("button", { name: ptMessages.financial.bulkGenerate }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(ptMessages.errors.api.serverError),
    );
    expect(app.refreshData).not.toHaveBeenCalled();
  });
});
