import { afterEach, describe, it, expect, vi } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import enMessages from "@/messages/en.json";
import { FinancialsView } from "./financials-view";

// Shared with the mock below, so a test can choose the receipts the screen holds.
const { app } = vi.hoisted(() => ({
  app: { receipts: [] as unknown[], addExpense: vi.fn() },
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
  }),
}));

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

describe("FinancialsView: a month with receipts", () => {
  afterEach(() => {
    app.receipts = [];
  });

  it("totals the month's income from the receipts it holds", () => {
    // The 15th, so "this month" holds it whatever the runner's timezone.
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
    app.receipts = [
      {
        id: "rec-1",
        userId: "user-1",
        tenantId: "tenant-1",
        tenantName: "Ana Costa",
        propertyId: "prop-1",
        propertyName: "Rua Augusta 12",
        amount: 950,
        date,
        type: "rent",
        status: "paid",
        createdAt: date,
        updatedAt: date,
      },
    ];
    render(<FinancialsView />);

    expect(screen.getByText(enMessages.financial.totalIncome, { exact: false })).toHaveTextContent(
      `${enMessages.financial.totalIncome} $950.00`,
    );
    expect(screen.getByRole("button", { name: enMessages.financial.addExpense })).toBeEnabled();
  });
});
