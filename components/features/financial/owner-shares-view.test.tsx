import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import { formatEuro } from "@/lib/utils/currency";
import { OwnerSharesView } from "./owner-shares-view";

/**
 * Finance › Repartição, in Portuguese: what each co-owner is due from the year's rent, and
 * **Registar pagamento** starting from what is still owed.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/financials",
  useSearchParams: () => new URLSearchParams("view=shares"),
}));
vi.mock("@/lib/contexts/csrf-context", () => ({ useCsrf: () => ({ token: "csrf" }) }));
vi.mock("@/lib/contexts/toast-context", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const part = (ownerId: string, ownerName: string, net: number) => ({
  ownerId,
  ownerName,
  percentages: [50],
  income: net,
  expenses: 0,
  reimbursed: 0,
  net,
});

const YEAR = {
  year: 2026,
  soleOwnerProperties: 0,
  income: 12000,
  expenses: 0,
  net: 12000,
  paid: 1000,
  outstanding: 11000,
  properties: [
    {
      propertyId: "p1",
      propertyName: "Rua Augusta 12",
      income: 12000,
      expenses: 0,
      net: 12000,
      owners: [part("ana", "Ana Costa", 6000), part("rui", "Rui Lopes", 6000)],
      unassigned: null,
      sharesChanged: false,
    },
  ],
  owners: [
    {
      ownerId: "ana",
      ownerName: "Ana Costa",
      propertyIds: ["p1"],
      income: 6000,
      expenses: 0,
      reimbursed: 0,
      net: 6000,
      paid: 0,
      balance: 6000,
      payouts: [],
    },
    {
      ownerId: "rui",
      ownerName: "Rui Lopes",
      propertyIds: ["p1"],
      income: 6000,
      expenses: 0,
      reimbursed: 0,
      net: 6000,
      paid: 1000,
      balance: 5000,
      payouts: [
        { id: "x1", ownerId: "rui", amount: 1000, paidAt: "2026-06-30T00:00:00.000Z", note: null },
      ],
    },
  ],
};

const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === "POST") {
    return { ok: true, status: 201, json: async () => ({ data: { id: "x2" } }) };
  }
  return { ok: true, status: 200, json: async () => ({ data: YEAR }) };
});

describe("OwnerSharesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-20T12:00:00.000Z") });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("says in Portuguese what each owner is due for the year", async () => {
    renderWithProviders(<OwnerSharesView />, { initialLocale: "pt" });

    expect(await screen.findByText("Ana Costa")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/owner-payouts?year=2026");
    const text = (s: string) => s.replace(/\s+/g, " ");
    expect(screen.getByText(text(`A pagar ${formatEuro(6000)}`))).toBeInTheDocument();
    expect(screen.getByText(text(`A pagar ${formatEuro(5000)}`))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Por proprietário" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Por imóvel" })).toBeInTheDocument();
    expect(screen.queryByText(/To pay|By owner/)).not.toBeInTheDocument();
  });

  it("records a payout starting from what the owner is still due", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OwnerSharesView />, { initialLocale: "pt" });
    await screen.findByText("Rui Lopes");

    await user.click(screen.getAllByRole("button", { name: "Registar entrega" })[1]);
    expect(screen.getByLabelText("Valor")).toHaveValue("5000,00");
    await user.click(
      screen.getAllByRole("button", { name: "Registar entrega" }).at(-1) as HTMLElement,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/owner-payouts",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({
      ownerId: "rui",
      year: 2026,
      amount: 5000,
      paidAt: "2026-12-20",
      note: null,
    });
  });

  it("shows an owner's payouts when the row is opened", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OwnerSharesView />, { initialLocale: "pt" });

    await user.click(await screen.findByRole("button", { name: /Rui Lopes/ }));

    expect(screen.getByText("Entregas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remover a entrega de/ })).toBeInTheDocument();
  });
});
