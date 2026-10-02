import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import { formatDate } from "@/lib/utils/format-date";
import ptMessages from "@/messages/pt.json";

/**
 * What the owner sees of the accounts they confirmed, in Portuguese: which account, who the bank
 * said it was, since when, and **Esquecer**. Nothing is drawn while nothing is remembered, and a
 * refusal is said in words, not as a lost connection.
 */

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/lib/contexts/csrf-context", () => ({ useCsrf: () => ({ token: "csrf-token" }) }));

import { PayerAccountsPanel } from "./payer-accounts-panel";

const ANA = {
  id: "acc-1",
  ibanLast4: "0154",
  holderName: "ANA COSTA",
  createdAt: "2026-06-10T00:00:00.000Z",
};
const BLIND = {
  id: "acc-2",
  ibanLast4: null,
  holderName: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

interface Reply {
  status?: number;
  body: unknown;
}

let accounts: unknown[];
let onDelete: () => Reply;
/** While set, a DELETE does not answer until it is released. */
let gate: Promise<void> | null;

beforeEach(() => {
  vi.clearAllMocks();
  gate = null;
  accounts = [ANA];
  onDelete = () => {
    accounts = [];
    return { body: { data: { forgotten: true } } };
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE" && gate) await gate;
      const reply: Reply = init?.method === "DELETE" ? onDelete() : { body: { data: accounts } };
      const status = reply.status ?? 200;
      return { ok: status < 400, status, statusText: "", json: async () => reply.body } as Response;
    }),
  );
});

const calls = () => vi.mocked(fetch).mock.calls.map(([url, init]) => [String(url), init?.method]);

describe("PayerAccountsPanel", () => {
  it("names each account, who the bank said it was, and since when", async () => {
    accounts = [ANA, BLIND];
    render(<PayerAccountsPanel tenantId="t1" tenantName="Maria Silva" />, { initialLocale: "pt" });

    expect(await screen.findByText("Contas de onde vêm os pagamentos")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Foram confirmadas por si. Um pagamento de uma destas contas com o mesmo valor da renda é conciliado com Maria Silva automaticamente; qualquer outro valor continua a aguardar a sua decisão.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("ANA COSTA · Conta terminada em 0154")).toBeInTheDocument();
    expect(
      screen.getByText(`Memorizada em ${formatDate(ANA.createdAt, "pt")}`),
    ).toBeInTheDocument();
    // An account the bank gave neither name nor number for still has a row to forget.
    expect(screen.getByText("Conta")).toBeInTheDocument();
    expect(calls()).toEqual([["/api/tenants/t1/payer-accounts", "GET"]]);
  });

  it("draws nothing while no account is remembered", async () => {
    accounts = [];
    render(<PayerAccountsPanel tenantId="t1" tenantName="Maria Silva" />, { initialLocale: "pt" });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByText("Contas de onde vêm os pagamentos")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("forgets the account the owner names, says so, and takes it off the list", async () => {
    const user = userEvent.setup();
    render(<PayerAccountsPanel tenantId="t1" tenantName="Maria Silva" />, { initialLocale: "pt" });

    await user.click(
      await screen.findByRole("button", { name: "Esquecer ANA COSTA · Conta terminada em 0154" }),
    );

    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Conta esquecida. Os pagamentos desta conta voltam a aguardar a sua decisão.",
      ),
    );
    expect(calls()).toContainEqual(["/api/tenants/t1/payer-accounts/acc-1", "DELETE"]);
    const sent = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "DELETE");
    expect((sent?.[1]?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-token");
    await vi.waitFor(() =>
      expect(screen.queryByText("Contas de onde vêm os pagamentos")).not.toBeInTheDocument(),
    );
  });

  it("does not send the same forgetting twice while one is on its way", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    render(<PayerAccountsPanel tenantId="t1" tenantName="Maria Silva" />, { initialLocale: "pt" });
    const forget = await screen.findByRole("button", { name: /^Esquecer ANA COSTA/ });

    await user.click(forget);
    await vi.waitFor(() => expect(forget).toBeDisabled());
    await user.click(forget);
    release();

    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(calls().filter(([, method]) => method === "DELETE")).toHaveLength(1);
  });

  it("says in words why forgetting was refused, and keeps the account listed", async () => {
    const user = userEvent.setup();
    onDelete = () => ({ status: 404, body: { error: "Payer account not found" } });
    render(<PayerAccountsPanel tenantId="t1" tenantName="Maria Silva" />, { initialLocale: "pt" });

    await user.click(await screen.findByRole("button", { name: /^Esquecer ANA COSTA/ }));

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(ptMessages.errors.api.notFound),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText("ANA COSTA · Conta terminada em 0154")).toBeInTheDocument();
  });

  it("says in Portuguese when the accounts cannot be read", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "",
      json: async () => ({ error: "Tenant not found" }),
    } as Response);
    render(<PayerAccountsPanel tenantId="t9" tenantName="Maria Silva" />, { initialLocale: "pt" });

    expect(await screen.findByRole("alert")).toHaveTextContent(ptMessages.errors.api.notFound);
    expect(screen.queryByText(/Tenant not found/)).not.toBeInTheDocument();
  });
});
