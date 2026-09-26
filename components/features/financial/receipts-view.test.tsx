import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { within } from "@testing-library/dom";
import {
  renderWithProviders as render,
  screen,
  waitFor,
} from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import { ReceiptsView } from "./receipts-view";

/**
 * Finance › Recibos lists one rent month at a time, in Portuguese: each receipt under the rent
 * month it paid, or the month it was paid when it paid none. **Select all** takes only what can be
 * issued, **Emitir** asks first, and a refusal says why. Asserted in Portuguese, since asserting
 * English cannot catch hardcoded English.
 */

const pt = ptMessages.financial.receipts;

// Shared with the mocks below, so a test can choose the receipts and see what the screen did.
const { app, toast } = vi.hoisted(() => ({
  app: {
    receipts: [] as unknown[],
    updateReceipt: vi.fn(async () => {}),
    deleteReceipt: vi.fn(async (_id: string) => {}),
    refreshData: vi.fn(async () => {}),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `€${amount.toFixed(2)}`,
    currencySymbol: "€",
  }),
}));
vi.mock("@/lib/contexts/csrf-context", () => ({ useCsrf: () => ({ token: "csrf" }) }));
vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: { receipts: app.receipts, tenants: [], properties: [], loading: false },
    updateReceipt: app.updateReceipt,
    deleteReceipt: app.deleteReceipt,
    refreshData: app.refreshData,
  }),
}));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));

const receipt = (
  id: string,
  overrides: {
    tenantName?: string;
    date?: string;
    referenceMonth?: string | null;
    lifecycle?: string;
    source?: string;
    status?: string;
    amount?: number;
  } = {},
) => ({
  id,
  userId: "user-1",
  tenantId: `tenant-${id}`,
  tenantName: overrides.tenantName ?? "Ana Costa",
  propertyId: "prop-1",
  propertyName: "Rua Augusta 12",
  amount: overrides.amount ?? 800,
  date: overrides.date ?? "2026-09-02",
  referenceMonth: overrides.referenceMonth === undefined ? "2026-09" : overrides.referenceMonth,
  type: "rent",
  status: overrides.status ?? "paid",
  lifecycle: overrides.lifecycle ?? "draft",
  source: overrides.source ?? "manual",
  createdAt: "2026-09-02",
  updatedAt: "2026-09-02",
});

/** Answers the lifecycle PUTs: 200, or a refusal for the ids listed. */
function stubLifecycle(refused: Record<string, { status: number; body: unknown }> = {}) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const id = /\/api\/receipts\/([^/]+)\/lifecycle/.exec(url)?.[1] ?? "";
    const refusal = refused[id];
    return refusal
      ? { ok: false, status: refusal.status, json: async () => refusal.body }
      : { ok: true, status: 200, json: async () => ({ data: { lifecycle: "emitted" } }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function show() {
  render(<ReceiptsView />, { initialLocale: "pt" });
  return userEvent.setup();
}

/** The table and the phone cards are both in the DOM; the first copy is the table's. */
const first = <T,>(items: T[]) => items[0];

describe("ReceiptsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-15T12:00:00.000Z") });
    stubLifecycle();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens on this month and moves between months", async () => {
    app.receipts = [
      receipt("r-sep"),
      receipt("r-aug", { tenantName: "Rui Silva", referenceMonth: "2026-08" }),
    ];
    const user = show();

    const monthLabel = (name: string) => screen.getByText(name, { selector: "span[aria-live]" });
    expect(monthLabel("setembro de 2026")).toBeInTheDocument();
    expect(first(screen.getAllByText("Ana Costa"))).toBeInTheDocument();
    expect(screen.queryByText("Rui Silva")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ptMessages.common.previousMonth }));

    expect(monthLabel("agosto de 2026")).toBeInTheDocument();
    expect(first(screen.getAllByText("Rui Silva"))).toBeInTheDocument();
    expect(screen.queryByText("Ana Costa")).not.toBeInTheDocument();
  });

  it("lists a receipt under the month it paid, or the month it was paid when it paid none", () => {
    app.receipts = [
      // Paid on 2 September for August: an August receipt.
      receipt("r-late", { tenantName: "Rui Silva", date: "2026-09-02", referenceMonth: "2026-08" }),
      // Never allocated: listed under the month it came in.
      receipt("r-loose", { tenantName: "Eva Lima", date: "2026-09-10", referenceMonth: null }),
    ];
    show();

    expect(screen.queryByText("Rui Silva")).not.toBeInTheDocument();
    expect(first(screen.getAllByText("Eva Lima"))).toBeInTheDocument();
    expect(first(screen.getAllByText(pt.noRentMonth))).toBeInTheDocument();
  });

  it("counts the month's receipts, what is left to issue, and the total", () => {
    app.receipts = [
      receipt("r-1", { lifecycle: "draft", amount: 800 }),
      receipt("r-2", { tenantName: "Rui Silva", lifecycle: "emitted", amount: 650.5 }),
    ];
    show();

    expect(screen.getByText("2 recibos · 1 por emitir · €1450.50")).toBeInTheDocument();
  });

  it("shows each receipt's stage and where it came from, never a stored code", () => {
    app.receipts = [
      receipt("r-1", { lifecycle: "review", source: "automation", status: "pending" }),
    ];
    show();

    expect(first(screen.getAllByText(pt.lifecycle.review))).toBeInTheDocument();
    expect(first(screen.getAllByText(pt.source.bank))).toBeInTheDocument();
    expect(first(screen.getAllByText(ptMessages.status.pending))).toBeInTheDocument();
    expect(screen.queryByText(/^(review|automation|Receipt #)/)).not.toBeInTheDocument();
  });

  it("selects all only the receipts that can be issued, and issues them after asking", async () => {
    app.receipts = [
      receipt("r-draft", { lifecycle: "draft" }),
      receipt("r-review", { tenantName: "Eva Lima", lifecycle: "review" }),
      receipt("r-done", { tenantName: "Rui Silva", lifecycle: "emitted" }),
    ];
    const fetchMock = stubLifecycle();
    const user = show();

    await user.click(first(screen.getAllByRole("checkbox", { name: pt.selectAll })));
    await user.click(screen.getByRole("button", { name: "Emitir 2" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Emitir 2 recibos?");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: pt.issueDialog.confirmLabel }));

    await waitFor(() => expect(app.refreshData).toHaveBeenCalled());
    const issued = fetchMock.mock.calls.map(([url]) => url);
    expect(issued).toEqual(["/api/receipts/r-draft/lifecycle", "/api/receipts/r-review/lifecycle"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ to: "emitted" });
    expect(toast.success).toHaveBeenCalledWith("2 recibos emitidos.");
  });

  it("says in Portuguese why a receipt was not issued, and keeps it ticked for a retry", async () => {
    app.receipts = [
      receipt("r-ok", { lifecycle: "draft" }),
      receipt("r-no", { tenantName: "Eva Lima", lifecycle: "draft" }),
    ];
    stubLifecycle({
      "r-no": {
        status: 409,
        body: { error: "Cannot move", reason: "receipt_transition_not_allowed" },
      },
    });
    const user = show();

    await user.click(first(screen.getAllByRole("checkbox", { name: pt.selectAll })));
    await user.click(screen.getByRole("button", { name: "Emitir 2" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: pt.issueDialog.confirmLabel,
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(pt.issueFailed);
    expect(alert).toHaveTextContent(
      `Eva Lima · Rua Augusta 12: ${ptMessages.errors.api.receiptTransitionNotAllowed}`,
    );
    expect(toast.success).toHaveBeenCalledWith("1 recibo emitido.");
    expect(screen.getByRole("button", { name: "Emitir 1" })).toBeInTheDocument();
  });

  it("offers no box for a receipt that cannot be issued", () => {
    app.receipts = [receipt("r-done", { lifecycle: "emitted" })];
    show();

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("says when a month has no receipts", () => {
    app.receipts = [];
    show();

    expect(screen.getByText("Sem recibos em setembro de 2026.")).toBeInTheDocument();
  });
});

/**
 * Deleting a receipt takes its payment off the rent ledger (`receiptService.delete`), so the
 * confirmation has to say so. A receipt already submitted to Finanças is kept, and the screen says
 * why rather than letting the route answer with a generic conflict.
 */
describe("ReceiptsView: deleting and voiding a receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-15T12:00:00.000Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const choose = async (user: ReturnType<typeof userEvent.setup>, item: string) => {
    await user.click(first(screen.getAllByRole("button", { name: pt.options })));
    await user.click(await screen.findByRole("menuitem", { name: item }));
  };

  it("says the month goes back to unpaid, then deletes and reloads the ledger", async () => {
    app.receipts = [receipt("rec-1", { lifecycle: "emitted" })];
    const user = show();

    await choose(user, pt.delete);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(pt.deleteDialog.description);
    await user.click(within(dialog).getByRole("button", { name: pt.deleteDialog.confirmLabel }));

    await waitFor(() => expect(app.refreshData).toHaveBeenCalledTimes(1));
    expect(app.deleteReceipt).toHaveBeenCalledWith("rec-1");
    expect(toast.success).toHaveBeenCalledWith(pt.toastDeleted);
  });

  it("keeps a receipt submitted to Finanças, and says why", async () => {
    app.receipts = [receipt("rec-1", { lifecycle: "submitted" })];
    const user = show();

    await choose(user, pt.delete);

    expect(toast.error).toHaveBeenCalledWith(pt.deleteFiled);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(app.deleteReceipt).not.toHaveBeenCalled();
  });

  it("voids an issued receipt after saying its month goes back to unpaid", async () => {
    app.receipts = [receipt("rec-1", { lifecycle: "emitted" })];
    const fetchMock = stubLifecycle();
    const user = show();

    await choose(user, pt.void);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(pt.voidDialog.description);
    await user.click(within(dialog).getByRole("button", { name: pt.voidDialog.confirmLabel }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(pt.toastVoided));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ to: "voided" });
    expect(app.refreshData).toHaveBeenCalled();
  });

  it("offers no void once a receipt has gone to Finanças", async () => {
    app.receipts = [receipt("rec-1", { lifecycle: "submitted" })];
    const user = show();

    await user.click(first(screen.getAllByRole("button", { name: pt.options })));

    expect(await screen.findByRole("menuitem", { name: pt.delete })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: pt.void })).not.toBeInTheDocument();
  });
});
