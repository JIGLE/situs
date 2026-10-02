import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import { formatDate } from "@/lib/utils/format-date";

/**
 * The bank inbox, asserted in Portuguese: it opens on the movements waiting for the owner, says
 * what each action did, and says why the server refused one. It used to open on every movement,
 * speak in status codes, and report any refusal as a lost connection.
 */

const { toast, refreshData } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  refreshData: vi.fn(),
}));

vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/lib/contexts/csrf-context", () => ({ useCsrf: () => ({ token: "csrf-token" }) }));
vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      leases: [{ id: "lease-1", tenantId: "t1", propertyId: "p1", status: "active" }],
      tenants: [{ id: "t1", name: "Maria Silva" }],
      properties: [{ id: "p1", name: "Rua A, 1" }],
    },
    refreshData,
  }),
}));

import { BankMovementsInbox } from "./bank-movements-inbox";

const MONEY_IN = {
  id: "txn-in",
  amount: 850,
  currency: "EUR",
  bookingDate: "2026-09-01T12:00:00.000Z",
  valueDate: null,
  counterpartyName: "MARIA SILVA",
  reference: "Renda setembro",
  status: "needs_review",
  suggestedLeaseId: "lease-1",
  matchConfidence: 0.8,
  matchReasons: JSON.stringify({ reasons: ["iban_match", "amount_exact"], warnings: [] }),
  duplicateOfId: null,
  receiptId: null,
  bankAccount: { label: "Conta ordenado" },
  suggestedLease: { tenantName: "Maria Silva", propertyName: "Rua A, 1" },
};

const SUMMARY = { toReview: 1, outgoing: 4, autoMatched: 0, confirmed: 2, ignored: 1, all: 8 };

interface Reply {
  status?: number;
  body: unknown;
}

let rows: unknown[];
let connections: unknown[];
let onPut: (body: { action: string }) => Reply;

beforeEach(() => {
  vi.clearAllMocks();
  rows = [MONEY_IN];
  connections = [];
  onPut = () => ({ body: { data: { status: "matched_confirmed", receiptId: "r1" } } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      let reply: Reply = { body: { data: rows } };
      if (url.startsWith("/api/bank/connections") && url.endsWith("/sync")) {
        reply = { body: { data: { summaries: [{ imported: 3 }] } } };
      } else if (url.startsWith("/api/bank/connections")) {
        reply = { body: { data: { connections, providersConfigured: ["enablebanking"] } } };
      } else if (init?.method === "PUT") {
        reply = onPut(JSON.parse(String(init.body)));
      }
      const status = reply.status ?? 200;
      return { ok: status < 400, status, statusText: "", json: async () => reply.body } as Response;
    }),
  );
});

const fetchCalls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));

describe("BankMovementsInbox", () => {
  it("opens on money in waiting for review, and names each filter with its count", async () => {
    render(<BankMovementsInbox summary={SUMMARY} />, { initialLocale: "pt" });

    expect((await screen.findAllByText("MARIA SILVA")).length).toBeGreaterThan(0);
    expect(fetchCalls()).toContain("/api/bank/transactions?status=needs_review&direction=in");
    expect(
      screen.getByRole("combobox", { name: "Filtrar movimentos por estado" }),
    ).toHaveTextContent("A rever (1)");
  });

  it("shows the movement in the owner's language and money format", async () => {
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    expect((await screen.findAllByText("IBAN conhecido · Igual à renda")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("A rever").length).toBeGreaterThan(0);
    expect(screen.getAllByText("€850,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatDate(MONEY_IN.bookingDate, "pt")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/REVIEW|iban match/)).not.toBeInTheDocument();
  });

  it("says why a refused action was refused, not that the connection dropped", async () => {
    const user = userEvent.setup();
    onPut = () => ({
      status: 409,
      body: { error: "A lease is required", reason: "bank_lease_required" },
    });
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    await user.click((await screen.findAllByRole("button", { name: /Confirmar/ }))[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Escolha o contrato a que este pagamento pertence, em Atribuir.",
    );
    expect(screen.queryByText(/contactar o servidor/)).not.toBeInTheDocument();
  });

  it("says whose payment a confirmation turned into a receipt, and refreshes what reads it", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<BankMovementsInbox onChanged={onChanged} />, { initialLocale: "pt" });

    await user.click((await screen.findAllByRole("button", { name: /Confirmar/ }))[0]);

    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Pagamento de Maria Silva confirmado: foi criado um recibo.",
      ),
    );
    expect(refreshData).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("says so when the confirmation taught an account, and what that means from now on", async () => {
    const user = userEvent.setup();
    onPut = () => ({
      body: { data: { status: "matched_confirmed", receiptId: "r1", remembered: true } },
    });
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    await user.click((await screen.findAllByRole("button", { name: /Confirmar/ }))[0]);

    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Pagamento de Maria Silva confirmado: foi criado um recibo. A partir de agora, um pagamento desta conta com o mesmo valor da renda é conciliado automaticamente.",
      ),
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("says where an ignored movement went, and offers to restore one", async () => {
    const user = userEvent.setup();
    onPut = ({ action }) => ({ body: { data: { status: action, receiptId: null } } });
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    await user.click((await screen.findAllByRole("button", { name: "Ignorar" }))[0]);
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Movimento ignorado. Fica em Ignorados."),
    );

    rows = [{ ...MONEY_IN, status: "ignored" }];
    render(<BankMovementsInbox />, { initialLocale: "pt" });
    await user.click((await screen.findAllByRole("button", { name: /Repor/ }))[0]);

    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Movimento de volta a A rever."),
    );
    const put = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === "PUT")
      .pop();
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ action: "restore" });
  });
});

/**
 * A movement that may be a payment the owner recorded by hand. Whether it is, is the owner's to
 * say: Confirm, which would allocate it again, gives way to "same payment" and "a new payment".
 */
describe("a movement that looks like a payment the owner recorded", () => {
  const RECORDED = { id: "rcpt-1", date: "2026-08-30", amount: 850 };
  const withRecorded = (...recordedPayments: (typeof RECORDED)[]) => ({
    ...MONEY_IN,
    recordedPayments,
  });
  /** The PUT bodies sent so far. */
  const puts = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === "PUT")
      .map(([, init]) => JSON.parse(String(init?.body)));

  it("shows what was recorded, and offers the two answers instead of Confirm", async () => {
    rows = [withRecorded(RECORDED)];
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    expect(
      (await screen.findAllByText(`Registou €850,00 em ${formatDate(RECORDED.date, "pt")}`)).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Mesmo pagamento/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Um novo pagamento/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Confirmar/ })).not.toBeInTheDocument();
    // Assigning to another lease and ignoring stay.
    expect(screen.getAllByRole("button", { name: "Atribuir" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Ignorar" }).length).toBeGreaterThan(0);
  });

  it("still offers Confirm when nothing was recorded", async () => {
    rows = [withRecorded()];
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    expect((await screen.findAllByRole("button", { name: /Confirmar/ })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Mesmo pagamento/ })).not.toBeInTheDocument();
  });

  it("links it to the payment, says nothing was counted twice, and creates no receipt", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    onPut = () => ({ body: { data: { status: "matched_confirmed", receiptId: "rcpt-1" } } });
    rows = [withRecorded(RECORDED)];
    render(<BankMovementsInbox onChanged={onChanged} />, { initialLocale: "pt" });

    await user.click((await screen.findAllByRole("button", { name: /Mesmo pagamento/ }))[0]);

    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Ligado ao pagamento que registou. Nada foi contado duas vezes.",
      ),
    );
    expect(puts()).toEqual([{ action: "link", receiptId: "rcpt-1" }]);
    // A link makes no receipt and pays no month, so there is nothing for the app state to reload.
    expect(refreshData).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("says so when linking it taught the account too", async () => {
    const user = userEvent.setup();
    onPut = () => ({
      body: { data: { status: "matched_confirmed", receiptId: "rcpt-1", remembered: true } },
    });
    rows = [withRecorded(RECORDED)];
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    await user.click((await screen.findAllByRole("button", { name: /Mesmo pagamento/ }))[0]);

    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Ligado ao pagamento que registou. Nada foi contado duas vezes. A partir de agora, um pagamento desta conta com o mesmo valor da renda é conciliado automaticamente.",
      ),
    );
  });

  it("confirms it as a new payment, which does create the receipt", async () => {
    const user = userEvent.setup();
    rows = [withRecorded(RECORDED)];
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    await user.click((await screen.findAllByRole("button", { name: /Um novo pagamento/ }))[0]);

    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Pagamento de Maria Silva confirmado: foi criado um recibo.",
      ),
    );
    expect(puts()).toEqual([{ action: "confirm", newPayment: true }]);
    expect(refreshData).toHaveBeenCalled();
  });

  it("says nothing was confirmed when the server held the movement instead", async () => {
    const user = userEvent.setup();
    // A row the list showed with nothing recorded, confirmed after the owner recorded a payment.
    onPut = () => ({
      body: { data: { status: "needs_review", receiptId: null, recordedPayments: [RECORDED] } },
    });
    rows = [MONEY_IN];
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    await user.click((await screen.findAllByRole("button", { name: /Confirmar/ }))[0]);

    await vi.waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        "Maria Silva tem um pagamento deste valor registado por volta desta data. Diga se é o mesmo pagamento.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(refreshData).not.toHaveBeenCalled();
  });

  it("names each payment by its date when more than one fits", async () => {
    const earlier = { id: "rcpt-0", date: "2026-08-28", amount: 850 };
    rows = [withRecorded(RECORDED, earlier)];
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    expect(
      (
        await screen.findAllByRole("button", {
          name: `Mesmo pagamento, ${formatDate(RECORDED.date, "pt")}`,
        })
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", {
        name: `Mesmo pagamento, ${formatDate(earlier.date, "pt")}`,
      }).length,
    ).toBeGreaterThan(0);
  });

  it("says why a link was refused, in words", async () => {
    const user = userEvent.setup();
    onPut = () => ({
      status: 409,
      body: { error: "That payment is already linked", reason: "bank_payment_already_linked" },
    });
    rows = [withRecorded(RECORDED)];
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    await user.click((await screen.findAllByRole("button", { name: /Mesmo pagamento/ }))[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esse pagamento já está ligado a outro movimento.",
    );
  });
});

describe("the bank strip above the inbox", () => {
  const bank = (overrides: Record<string, unknown> = {}) => ({
    id: "conn-1",
    provider: "psd2_enablebanking",
    institutionName: "Banco BPI",
    status: "active",
    lastSyncAt: "2026-09-24T06:00:00.000Z",
    consentExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    isProvider: true,
    canSync: true,
    remainingBudget: 3,
    ...overrides,
  });

  it("points to Settings when no bank is connected", async () => {
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    expect(await screen.findByText(/Nenhum banco ligado/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ligar um banco" })).toHaveAttribute(
      "href",
      "/settings?tab=integrations",
    );
  });

  it("warns before consent ends, and says when today's syncs are spent", async () => {
    connections = [
      bank({
        consentExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        remainingBudget: 0,
      }),
    ];
    render(<BankMovementsInbox />, { initialLocale: "pt" });

    expect(await screen.findByText(/O consentimento termina a/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sincronizar agora/ })).toBeDisabled();
    expect(screen.getByText("0 sincronizações restantes hoje")).toBeInTheDocument();
  });

  it("syncs from the inbox and says what arrived", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    connections = [bank()];
    render(<BankMovementsInbox onChanged={onChanged} />, { initialLocale: "pt" });

    await user.click(await screen.findByRole("button", { name: /Sincronizar agora/ }));

    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Sincronizado: 3 movimentos novos."),
    );
    expect(onChanged).toHaveBeenCalled();
    expect(fetchCalls()).toContain("/api/bank/connections/conn-1/sync");
  });
});
