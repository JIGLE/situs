import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import pt from "@/messages/pt.json";

const { app } = vi.hoisted(() => ({
  app: {
    expenses: [] as Record<string, unknown>[],
    addExpense: vi.fn(async (data: Record<string, unknown>) => ({ id: "exp-new", ...data })),
    updateExpense: vi.fn(async () => undefined),
    deleteExpense: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      expenses: app.expenses,
      properties: [
        { id: "prop-1", name: "Rua Augusta 12" },
        { id: "prop-2", name: "Rua do Ouro 3" },
      ],
      loading: false,
    },
    addExpense: app.addExpense,
    updateExpense: app.updateExpense,
    deleteExpense: app.deleteExpense,
  }),
}));
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({ formatCurrency: (n: number) => `${n} €`, currencySymbol: "€" }),
}));

import { ExpensesView } from "./expenses-view";
import { ExpenseDialog, useExpenseDialog } from "./expense-dialog";

const fin = pt.financial;

const expense = (over: Record<string, unknown>) => ({
  id: "exp-1",
  propertyId: "prop-1",
  propertyName: "Rua Augusta 12",
  category: "condominium_fees",
  amount: 40,
  date: "2026-10-05",
  ...over,
});

beforeAll(() => {
  // Radix measures its popovers; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.clearAllMocks();
  app.expenses = [];
});

/** The property page's case: the property is fixed, so the form does not ask for it. */
function PropertyExpense() {
  const dialog = useExpenseDialog("prop-2");
  return (
    <>
      <button onClick={dialog.openDialog}>open</button>
      <ExpenseDialog dialog={dialog} propertyName="Rua do Ouro 3" />
    </>
  );
}

/**
 * Finance › Expenses, and the one expense form that it and the property page share. Expenses used
 * to sit under the income list in the Tax summary tab, and the property page had a copy of the
 * form without the recurring options.
 */
describe("ExpensesView", () => {
  it("lists every expense, newest first, with their count and total", () => {
    app.expenses = [
      expense({ id: "a", date: "2026-09-01", amount: 60, category: "repairs" }),
      expense({ id: "b", date: "2026-10-05" }),
    ];
    renderWithProviders(<ExpensesView />, { initialLocale: "pt" });

    expect(screen.getByText("2 despesas · 100 €")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem").map((row: HTMLElement) => row.textContent);
    expect(rows[0]).toContain(fin.categories.condominium_fees);
    expect(rows[1]).toContain(fin.categories.repairs);
  });

  it("says when there is none", () => {
    renderWithProviders(<ExpensesView />, { initialLocale: "pt" });

    expect(screen.getByText(fin.noExpenseRecords)).toBeInTheDocument();
  });

  it("asks which property an expense added here is for", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExpensesView />, { initialLocale: "pt" });

    await user.click(screen.getByRole("button", { name: fin.addExpense }));

    const dialog = await screen.findByRole("dialog", { name: fin.recordExpense });
    expect(dialog).toHaveTextContent(fin.expenseForm.property);
    expect(screen.getByRole("switch", { name: fin.isRecurring })).toBeInTheDocument();
  });

  it("saves an expense against the property it was opened from", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PropertyExpense />, { initialLocale: "pt" });

    await user.click(screen.getByRole("button", { name: "open" }));
    const dialog = await screen.findByRole("dialog", { name: fin.recordExpense });
    expect(dialog).toHaveTextContent("Registe um custo de Rua do Ouro 3");
    expect(screen.queryByText(fin.expenseForm.property)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Valor/), "75");
    await user.click(screen.getByRole("button", { name: fin.expenseForm.submit }));

    await waitFor(() =>
      expect(app.addExpense).toHaveBeenCalledWith(
        expect.objectContaining({ propertyId: "prop-2", amount: 75, category: "other" }),
      ),
    );
  });

  it("takes an amount written the Portuguese way", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PropertyExpense />, { initialLocale: "pt" });

    await user.click(screen.getByRole("button", { name: "open" }));
    await user.type(await screen.findByLabelText(/Valor/), "3200,50");
    await user.click(screen.getByRole("button", { name: fin.expenseForm.submit }));

    await waitFor(() =>
      expect(app.addExpense).toHaveBeenCalledWith(expect.objectContaining({ amount: 3200.5 })),
    );
  });

  it("opens a recorded expense to change it", async () => {
    app.expenses = [expense({ description: "Quota de outubro" })];
    const user = userEvent.setup();
    renderWithProviders(<ExpensesView />, { initialLocale: "pt" });

    await user.click(screen.getByRole("button", { name: /Quota de outubro/ }));
    await screen.findByRole("dialog", { name: fin.expenseForm.editTitle });
    const amount = screen.getByLabelText(/Valor/);
    expect(amount).toHaveValue("40,00");

    await user.clear(amount);
    await user.type(amount, "45");
    await user.click(screen.getByRole("button", { name: pt.actions.save }));

    await waitFor(() =>
      expect(app.updateExpense).toHaveBeenCalledWith(
        "exp-1",
        expect.objectContaining({ amount: 45, category: "condominium_fees", propertyId: "prop-1" }),
      ),
    );
    expect(app.addExpense).not.toHaveBeenCalled();
  });

  it("deletes a recorded expense once the owner confirms", async () => {
    app.expenses = [expense({})];
    const user = userEvent.setup();
    renderWithProviders(<ExpensesView />, { initialLocale: "pt" });

    await user.click(screen.getByRole("button", { name: /40 €/ }));
    await screen.findByRole("dialog", { name: fin.expenseForm.editTitle });
    await user.click(screen.getByRole("button", { name: pt.actions.delete }));
    expect(app.deleteExpense).not.toHaveBeenCalled();

    await screen.findByText(fin.expenseForm.deleteTitle);
    const deletes = screen.getAllByRole("button", { name: pt.actions.delete });
    await user.click(deletes[deletes.length - 1]);

    await waitFor(() => expect(app.deleteExpense).toHaveBeenCalledWith("exp-1"));
  });

  it("says when a recurring expense repeats next", () => {
    app.expenses = [
      expense({
        isRecurring: true,
        recurrenceRule: "monthly",
        recurrenceDay: 1,
        date: "2026-01-01",
      }),
    ];
    renderWithProviders(<ExpensesView />, { initialLocale: "pt" });

    expect(screen.getByText(/Repete todos os meses · próxima/)).toBeInTheDocument();
  });
});
