import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import pt from "@/messages/pt.json";

const { app } = vi.hoisted(() => ({
  app: {
    expenses: [] as Record<string, unknown>[],
    owners: [] as Record<string, unknown>[],
    addExpense: vi.fn(async (data: Record<string, unknown>) => ({ id: "exp-new", ...data })),
    updateExpense: vi.fn(async () => undefined),
    deleteExpense: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      expenses: app.expenses,
      owners: app.owners,
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
const { reader } = vi.hoisted(() => ({
  reader: {
    readInvoiceFile: vi.fn(),
    uploadInvoice: vi.fn(async () => "doc-1"),
  },
}));
vi.mock("./invoice-reader", () => reader);

vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({ formatCurrency: (n: number) => `${n} €`, currencySymbol: "€" }),
}));

import { ExpensesView } from "./expenses-view";
import { ExpenseDialog, useExpenseDialog } from "./expense-dialog";

const fin = pt.financial;
// Fixtures sit in this year and the last, so the default year view shows them in any year.
const YEAR = new Date().getFullYear();

const expense = (over: Record<string, unknown>) => ({
  id: "exp-1",
  propertyId: "prop-1",
  propertyName: "Rua Augusta 12",
  category: "condominium_fees",
  amount: 40,
  date: `${YEAR}-10-05`,
  ...over,
});

beforeAll(() => {
  // Radix Select asks the DOM for pointer capture and scrolls the chosen item into view; jsdom has
  // neither.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
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
  app.owners = [];
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
      expense({ id: "a", date: `${YEAR}-09-01`, amount: 60, category: "repairs" }),
      expense({ id: "b", date: `${YEAR}-10-05` }),
    ];
    renderWithProviders(<ExpensesView />, { initialLocale: "pt" });

    expect(screen.getByText("2 despesas · 100 € · 100 € dedutível")).toBeInTheDocument();
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

  it("asks who paid only for a property with co-owners, and gives it back to the one chosen", async () => {
    app.owners = [
      { id: "jose", name: "José", properties: [{ propertyId: "prop-2", ownershipPercentage: 50 }] },
      { id: "rui", name: "Rui", properties: [{ propertyId: "prop-2", ownershipPercentage: 50 }] },
      { id: "ana", name: "Ana", properties: [{ propertyId: "prop-1", ownershipPercentage: 100 }] },
    ];
    const user = userEvent.setup();
    renderWithProviders(<PropertyExpense />, { initialLocale: "pt" });

    await user.click(screen.getByRole("button", { name: "open" }));
    await user.type(await screen.findByLabelText(/Valor/), "200");
    const paidBy = screen.getByRole("combobox", { name: fin.expenseForm.paidBy });
    expect(paidBy).toHaveTextContent(fin.expenseForm.paidByAccount);
    await user.click(paidBy);
    // The property's owners only: Ana owns another one.
    expect(screen.queryByRole("option", { name: "Ana" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Rui" }));
    await user.click(screen.getByRole("button", { name: fin.expenseForm.submit }));

    await waitFor(() =>
      expect(app.addExpense).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 200, paidByOwnerId: "rui" }),
      ),
    );
  });

  it("does not ask who paid for a property with one owner", async () => {
    app.owners = [
      { id: "ana", name: "Ana", properties: [{ propertyId: "prop-2", ownershipPercentage: 100 }] },
    ];
    const user = userEvent.setup();
    renderWithProviders(<PropertyExpense />, { initialLocale: "pt" });

    await user.click(screen.getByRole("button", { name: "open" }));
    await screen.findByLabelText(/Valor/);
    expect(screen.queryByText(fin.expenseForm.paidBy)).not.toBeInTheDocument();
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

  it("shows one year at a time, by month, with each property's deductible part", async () => {
    app.expenses = [
      expense({ id: "a", amount: 40 }),
      expense({ id: "b", amount: 800, category: "mortgage_interest", isDeductible: false }),
      expense({ id: "c", amount: 999, date: `${YEAR - 1}-03-01` }),
    ];
    const user = userEvent.setup();
    renderWithProviders(<ExpensesView />, { initialLocale: "pt" });

    expect(screen.getByText("2 despesas · 840 € · 40 € dedutível")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /outubro/i })).toBeInTheDocument();
    expect(screen.getByText(/Juros de Hipoteca/).closest("button")).toHaveTextContent(
      fin.notDeductible,
    );
    expect(screen.getByRole("heading", { name: fin.expensesByProperty })).toBeInTheDocument();
    expect(screen.getByText("40 € dedutível")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: fin.expenseYear }));
    await user.click(await screen.findByRole("option", { name: String(YEAR - 1) }));

    expect(screen.getByText("1 despesa · 999 € · 999 € dedutível")).toBeInTheDocument();
  });

  it("narrows to one group of categories", async () => {
    app.expenses = [
      expense({ id: "a", amount: 40 }),
      expense({ id: "b", amount: 75, category: "water" }),
    ];
    const user = userEvent.setup();
    renderWithProviders(<ExpensesView />, { initialLocale: "pt" });

    await user.click(screen.getByRole("combobox", { name: fin.expenseForm.category }));
    await user.click(await screen.findByRole("option", { name: fin.categoryGroups.utilities }));

    expect(screen.getByText("1 despesa · 75 € · 75 € dedutível")).toBeInTheDocument();
  });

  it("sets deductible from the category, and saves the supplier", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PropertyExpense />, { initialLocale: "pt" });

    await user.click(screen.getByRole("button", { name: "open" }));
    const deductible = await screen.findByRole("switch", { name: fin.deductibleLabel });
    expect(deductible).not.toBeChecked();

    await user.click(screen.getByRole("combobox", { name: fin.expenseForm.category }));
    await user.click(await screen.findByRole("option", { name: fin.categories.imi }));
    expect(deductible).toBeChecked();

    await user.type(screen.getByLabelText(/Valor/), "310");
    await user.type(screen.getByLabelText(/^Fornecedor/), "Câmara Municipal");
    await user.type(screen.getByLabelText(/NIF do fornecedor/), "501234567");
    await user.click(screen.getByRole("button", { name: fin.expenseForm.submit }));

    await waitFor(() =>
      expect(app.addExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "imi",
          isDeductible: true,
          vendorName: "Câmara Municipal",
          vendorVat: "501234567",
        }),
      ),
    );
  });

  it("reads invoices one by one, saving each with its file only once confirmed", async () => {
    app.expenses = [
      expense({
        id: "old",
        vendorVat: "509876543",
        vendorName: "Condomínio Rua Augusta",
        amount: 45,
      }),
    ];
    reader.readInvoiceFile
      .mockResolvedValueOnce({
        fields: { supplierNif: "509876543", date: `${YEAR}-11-05`, total: 45, source: "qr" },
        upload: { blob: new Blob(["a"]), mimeType: "image/jpeg", name: "condominio.jpg" },
      })
      .mockResolvedValueOnce({
        fields: null,
        upload: { blob: new Blob(["b"]), mimeType: "application/pdf", name: "scan.pdf" },
      });
    const user = userEvent.setup();
    renderWithProviders(<ExpensesView />, { initialLocale: "pt" });

    await user.upload(screen.getByLabelText(fin.invoice.readButton), [
      new File(["a"], "condominio.jpg", { type: "image/jpeg" }),
      new File(["b"], "scan.pdf", { type: "application/pdf" }),
    ]);

    const first = await screen.findByRole("dialog", { name: fin.recordExpense });
    expect(first).toHaveTextContent("Fatura 1 de 2 · condominio.jpg");
    expect(first).toHaveTextContent(fin.invoice.readQr);
    expect(screen.getByLabelText(/Valor/)).toHaveValue("45,00");
    expect(reader.uploadInvoice).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: fin.expenseForm.submit }));
    await waitFor(() =>
      expect(app.addExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 45,
          date: `${YEAR}-11-05`,
          vendorVat: "509876543",
          vendorName: "Condomínio Rua Augusta",
          category: "condominium_fees",
          propertyId: "prop-1",
          documentId: "doc-1",
        }),
      ),
    );

    // The second could not be read: the owner types it, and it stays attached.
    const second = await screen.findByText(/Fatura 2 de 2 · scan.pdf/);
    expect(second.closest("[role=dialog]")).toHaveTextContent(fin.invoice.unread);
    expect(screen.queryByRole("button", { name: fin.invoice.skip })).not.toBeInTheDocument();
  });

  it("leaves an invoice out with Saltar, saving nothing for it", async () => {
    reader.readInvoiceFile.mockImplementation(async (file: File) => ({
      fields: { total: 10, source: "text" },
      upload: { blob: file, mimeType: "application/pdf", name: file.name },
    }));
    const user = userEvent.setup();
    renderWithProviders(<ExpensesView />, { initialLocale: "pt" });

    await user.upload(screen.getByLabelText(fin.invoice.readButton), [
      new File(["a"], "a.pdf", { type: "application/pdf" }),
      new File(["b"], "b.pdf", { type: "application/pdf" }),
    ]);
    await screen.findByText(/Fatura 1 de 2 · a.pdf/);
    await user.click(screen.getByRole("button", { name: fin.invoice.skip }));

    await screen.findByText(/Fatura 2 de 2 · b.pdf/);
    expect(app.addExpense).not.toHaveBeenCalled();
    expect(reader.uploadInvoice).not.toHaveBeenCalled();
  });
});
