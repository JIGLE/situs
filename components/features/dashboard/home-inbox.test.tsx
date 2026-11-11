import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import pt from "@/messages/pt.json";

const { apiFetchMock, app, toast } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  app: { receipts: [] as Record<string, unknown>[], refreshData: vi.fn(async () => {}) },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/utils/api-client", () => ({ apiFetch: apiFetchMock }));
vi.mock("@/lib/contexts/csrf-context", () => ({ useCsrf: () => ({ token: "csrf" }) }));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({ formatCurrency: (amount: number) => `${amount} €` }),
}));
vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({ state: { receipts: app.receipts }, refreshData: app.refreshData }),
}));
// The review is its own component, with its own tests: here it only has to open.
vi.mock("@/components/features/financial/at-receipts-sheet", () => ({
  AtReceiptsSheet: ({ receipts }: { receipts: { tenantName: string }[] }) => (
    <div data-testid="at-review">{receipts.map((r) => r.tenantName).join(", ")}</div>
  ),
}));

import { HomeInbox } from "./home-inbox";

const inbox = pt.dashboard.inbox;
const bank = pt.financial.bank;

const movement = (over: Record<string, unknown> = {}) => ({
  id: "tx-1",
  amount: 850,
  currency: "EUR",
  bookingDate: "2026-11-02T00:00:00.000Z",
  counterpartyName: "J. SILVA",
  suggestedLeaseId: "lease-1",
  matchConfidence: 0.7,
  suggestedLease: { tenantName: "Ana Martínez", propertyName: "Rua Augusta 12" },
  recordedPayments: [],
  ...over,
});

const receipt = (over: Record<string, unknown> = {}) => ({
  id: "rec-1",
  tenantName: "Ana Martínez",
  propertyName: "Rua Augusta 12",
  amount: 850,
  date: "2026-11-02",
  referenceMonth: "2026-11",
  status: "paid",
  lifecycle: "draft",
  ...over,
});

let movements: ReturnType<typeof movement>[];

beforeEach(() => {
  vi.clearAllMocks();
  movements = [];
  app.receipts = [];
  apiFetchMock.mockImplementation(async (url: string, _csrf?: string, method?: string) => {
    if (url.startsWith("/api/bank/transactions?")) return movements;
    if (method === "PUT") return {};
    throw new Error(`unexpected ${url}`);
  });
});

function show() {
  const onChanged = vi.fn();
  renderWithProviders(<HomeInbox onChanged={onChanged} />, { initialLocale: "pt" });
  return { user: userEvent.setup(), onChanged };
}

/**
 * The month's work, on Home. Confirming a payment and marking its receipt issued used to take
 * Finance › Bank movements, then Finance › Receipts, then a review sheet.
 */
describe("HomeInbox", () => {
  it("says when nothing waits", async () => {
    show();
    expect(await screen.findByText(inbox.empty)).toBeInTheDocument();
  });

  it("confirms a payment from its card", async () => {
    movements = [movement()];
    const { user, onChanged } = show();

    expect(await screen.findByText(/850,00 de J\. SILVA$/)).toBeInTheDocument();
    expect(screen.getByText(/Ana Martínez · Rua Augusta 12/)).toBeInTheDocument();
    movements = [];
    await user.click(screen.getByRole("button", { name: bank.confirm }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith("/api/bank/transactions/tx-1", "csrf", "PUT", {
      action: "confirm",
    });
    expect(app.refreshData).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it("sends a payment it cannot settle to the movements list", async () => {
    movements = [
      movement({ id: "tx-2", suggestedLeaseId: null, suggestedLease: null }),
      movement({ id: "tx-3", recordedPayments: [{ id: "rec-9" }] }),
    ];
    show();

    const links = await screen.findAllByRole("link", { name: inbox.review });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/financials?tab=movements");
    expect(screen.queryByRole("button", { name: bank.confirm })).not.toBeInTheDocument();
  });

  it("marks a paid receipt issued, and lists no receipt that is pending or issued", async () => {
    app.receipts = [
      receipt(),
      receipt({ id: "rec-2", tenantName: "Rui Silva", status: "pending" }),
      receipt({ id: "rec-3", tenantName: "Eva Lopes", lifecycle: "emitted" }),
    ];
    const { user } = show();

    expect(await screen.findByText("Recibo pronto · Ana Martínez · 850 €")).toBeInTheDocument();
    expect(screen.queryByText(/Rui Silva|Eva Lopes/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: inbox.markIssued }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/receipts/rec-1/lifecycle", "csrf", "PUT", {
        to: "emitted",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("1 recibo marcado como emitido");
  });

  it("marks them all issued at once", async () => {
    app.receipts = [receipt(), receipt({ id: "rec-2", tenantName: "Rui Silva" })];
    const { user } = show();

    await user.click(await screen.findByRole("button", { name: "Marcar todos emitidos (2)" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("2 recibos marcados como emitidos"),
    );
  });

  it("opens the review, saying why, when Situs refuses to issue one", async () => {
    app.receipts = [receipt()];
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/bank/transactions?")) return [];
      throw Object.assign(new Error("conflict"), { status: 409 });
    });
    const { user } = show();

    await user.click(await screen.findByRole("button", { name: inbox.markIssued }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/^Ana Martínez: /);
    expect(screen.getByTestId("at-review")).toHaveTextContent("Ana Martínez");
  });

  it("opens the Portal details on asking", async () => {
    app.receipts = [receipt()];
    const { user } = show();

    await user.click(await screen.findByRole("button", { name: inbox.portalDetails }));

    expect(screen.getByTestId("at-review")).toHaveTextContent("Ana Martínez");
  });
});
