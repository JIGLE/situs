import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { within } from "@testing-library/dom";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import pt from "@/messages/pt.json";
import type { DashboardMonth } from "@/lib/services/dashboard/month";
import { formatDate } from "@/lib/utils/format-date";

/**
 * The dashboard: the month at a glance. Asserted in Portuguese, because asserting English cannot
 * catch hardcoded English. The figures themselves are the server's (lib/services/dashboard/month
 * and its tests); this checks that the screen says them, links them and moves between months.
 */

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock("@/lib/utils/api-client", () => ({ apiFetch: apiFetchMock }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { name: "José Pereira", email: "jose@example.com", id: "user-1" } },
    status: "authenticated",
  }),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({ formatCurrency: (amount: number) => `${amount} €` }),
}));
vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      properties: [{ id: "p1", name: "T2 Lisboa", status: "occupied" }],
      tenants: [{ id: "t1", name: "Ana Silva" }],
      leases: [{ id: "l1" }],
      receipts: [{ id: "r1" }],
      expenses: [],
      loading: false,
    },
  }),
}));

import { OverviewView } from "./overview-view";

const d = pt.dashboard;

function month(overrides: Partial<DashboardMonth> = {}): DashboardMonth {
  return {
    year: 2026,
    month: 8,
    figures: { expected: 1850, received: 950, outstanding: 900 },
    loop: {
      rents: 12,
      paid: 10,
      reconciled: 9,
      receiptsIssued: 11,
      receiptsToIssue: 1,
      filed: 10,
      fullyProcessed: 10,
    },
    attention: {
      monthsOwed: { count: 0, amount: 0 },
      movementsToReview: 0,
      receiptsInDraft: 0,
      leasesEnding: 0,
    },
    status: { bank: null, taxMode: "sandbox" },
    recent: { source: "payments", items: [] },
    portfolio: { properties: 8, occupied: 7, leasesEnding: 2 },
    activity: [],
    ...overrides,
  };
}

function show(answer: DashboardMonth = month(), search = "?month=2026-08") {
  window.history.replaceState({}, "", `/dashboard${search}`);
  apiFetchMock.mockResolvedValue(answer);
  render(<OverviewView />, { initialLocale: "pt" });
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("OverviewView — the month", () => {
  it("greets the owner by first name, and reads the month the URL names", async () => {
    show();

    expect(await screen.findByTestId("greeting")).toHaveTextContent(
      /^(Bom dia|Boa tarde|Boa noite), José$/,
    );
    expect(screen.getByTestId("dashboard-month")).toHaveTextContent("agosto de 2026");
    expect(apiFetchMock).toHaveBeenCalledWith("/api/dashboard/month?year=2026&month=8");
  });

  it("moves between months, across a year, and keeps the choice in the URL", async () => {
    const user = show(month(), "?month=2026-01");

    await user.click(screen.getByRole("button", { name: d.previousMonth }));

    expect(screen.getByTestId("dashboard-month")).toHaveTextContent("dezembro de 2025");
    expect(apiFetchMock).toHaveBeenLastCalledWith("/api/dashboard/month?year=2025&month=12");
    expect(window.location.search).toBe("?month=2025-12");

    await user.click(screen.getByRole("button", { name: d.nextMonth }));
    await user.click(screen.getByRole("button", { name: d.nextMonth }));

    expect(apiFetchMock).toHaveBeenLastCalledWith("/api/dashboard/month?year=2026&month=2");
    expect(window.location.search).toBe("?month=2026-02");
  });

  it("opens on the current month when the URL names none, or a month that does not exist", async () => {
    const now = new Date();
    show(month(), "?month=2026-13");

    await screen.findByTestId("dashboard-status");
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/dashboard/month?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
    );
  });

  it("says the month's three figures", async () => {
    show();

    expect(await screen.findByText(d.figureExpected)).toBeInTheDocument();
    expect(screen.getByText("1850 €")).toBeInTheDocument();
    expect(screen.getByText("950 €")).toBeInTheDocument();
    expect(screen.getByText("900 €")).toBeInTheDocument();
    expect(screen.getByText(d.figureOutstanding)).toBeInTheDocument();
  });

  it("says why the month could not be read", async () => {
    window.history.replaceState({}, "", "/dashboard?month=2026-08");
    apiFetchMock.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    render(<OverviewView />, { initialLocale: "pt" });

    expect(await screen.findByRole("alert")).toHaveTextContent(pt.errors.api.serverError);
  });
});

describe("OverviewView — the loop", () => {
  it("follows the month's rents step by step, each opening where its work is", async () => {
    show();

    expect(await screen.findByText("10 de 12 totalmente processados")).toBeInTheDocument();
    expect(screen.getByText("11 emitidos · 1 por emitir")).toBeInTheDocument();
    const hrefs = Object.fromEntries(
      [...document.querySelectorAll("a[data-step]")].map((a) => [
        a.getAttribute("data-step"),
        a.getAttribute("href"),
      ]),
    );
    expect(hrefs).toEqual({
      rents: "/financials?tab=rent-matrix",
      paid: "/financials?tab=rent-matrix",
      reconciled: "/financials?tab=bank",
      receipts: "/financials?tab=receipts",
      filed: "/financials?tab=tax",
    });
  });

  it("says so when no rent is due that month", async () => {
    show(month({ loop: { ...month().loop, rents: 0 } }));

    expect(await screen.findByText(d.loopEmpty)).toBeInTheDocument();
  });
});

describe("OverviewView — what waits", () => {
  it("lists only what waits, each opening where it is dealt with", async () => {
    show(
      month({
        attention: {
          monthsOwed: { count: 2, amount: 1050 },
          movementsToReview: 3,
          receiptsInDraft: 1,
          leasesEnding: 0,
        },
      }),
    );

    const list = await screen.findByTestId("dashboard-attention");
    expect(within(list).getByText(d.attentionTitle)).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "2 meses em atraso · 1050 €" })).toHaveAttribute(
      "href",
      "/financials?tab=rent-matrix",
    );
    expect(within(list).getByRole("link", { name: "3 movimentos para rever" })).toHaveAttribute(
      "href",
      "/financials?tab=bank",
    );
    expect(within(list).getByRole("link", { name: "1 recibo por emitir" })).toBeInTheDocument();
    expect(within(list).queryByText(/contrato/)).not.toBeInTheDocument();
  });

  it("shows no list when nothing waits", async () => {
    show();

    await screen.findByTestId("dashboard-status");
    expect(screen.queryByTestId("dashboard-attention")).not.toBeInTheDocument();
    expect(screen.queryByText(d.attentionTitle)).not.toBeInTheDocument();
  });
});

describe("OverviewView — the status line", () => {
  it("says no bank is connected, and that Finanças sends nothing", async () => {
    show();

    expect(await screen.findByTestId("dashboard-status")).toHaveTextContent(
      "Nenhum banco ligado · Finanças: simulação, nada é enviado",
    );
  });

  it("warns before the bank's consent ends, and says when it has", async () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    show(
      month({
        status: {
          bank: { lastSyncAt: "2026-09-27T06:00:00.000Z", consentEndsAt: soon, expired: false },
          taxMode: "test",
        },
      }),
    );

    const line = await screen.findByTestId("dashboard-status");
    expect(line).toHaveTextContent(
      `Banco sincronizado a ${formatDate("2026-09-27T06:00:00.000Z", "pt")}`,
    );
    expect(line).toHaveTextContent(`o consentimento termina a ${formatDate(soon, "pt")}`);
    expect(line).toHaveTextContent(d.statusTaxTest);
  });

  it("says the consent has ended", async () => {
    show(
      month({
        status: {
          bank: { lastSyncAt: null, consentEndsAt: null, expired: true },
          taxMode: "sandbox",
        },
      }),
    );

    expect(await screen.findByTestId("dashboard-status")).toHaveTextContent(d.statusConsentEnded);
  });
});

describe("OverviewView — recent money, the portfolio and activity", () => {
  it("marks each bank movement processed or to review", async () => {
    show(
      month({
        recent: {
          source: "bank",
          items: [
            {
              id: "tx-1",
              date: "2026-08-02T00:00:00.000Z",
              amount: 750,
              currency: "EUR",
              counterparty: "Ana Silva",
              state: "processed",
            },
            {
              id: "tx-2",
              date: "2026-08-03T00:00:00.000Z",
              amount: 600,
              currency: "EUR",
              counterparty: null,
              state: "review",
            },
          ],
        },
      }),
    );

    expect(await screen.findByText(d.recentMovements)).toBeInTheDocument();
    expect(screen.getByText(d.movementProcessed)).toBeInTheDocument();
    expect(screen.getByText(d.movementToReview)).toBeInTheDocument();
    // The section's own link leads to the inbox; the rows are not links.
    expect(screen.getByRole("link", { name: d.seeAll })).toHaveAttribute(
      "href",
      "/financials?tab=bank",
    );
    expect(screen.getByText(d.unknownCounterparty)).toBeInTheDocument();
  });

  it("shows the last payments when no bank is connected", async () => {
    show(
      month({
        recent: {
          source: "payments",
          items: [
            { id: "rec-1", date: "2026-08-02T00:00:00.000Z", amount: 750, tenantName: "Ana Silva" },
          ],
        },
      }),
    );

    expect(await screen.findByText(d.recentPayments)).toBeInTheDocument();
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
    expect(screen.queryByText(d.recentMovements)).not.toBeInTheDocument();
  });

  it("gives the portfolio as one line of text", async () => {
    show();

    expect(await screen.findByTestId("dashboard-portfolio")).toHaveTextContent(
      "8 imóveis · 7 ocupados (88%) · 2 contratos terminam em 60 dias",
    );
  });

  it("says the last audit entries in words, with the way to the whole trail", async () => {
    show(
      month({
        activity: [
          {
            id: "log-1",
            action: "BANK_CONNECTION_CREATED",
            resourceType: "bank_connection",
            createdAt: "2026-08-02T10:00:00.000Z",
          },
        ],
      }),
    );

    expect(await screen.findByText(pt.auditActions.bankConnectionCreated)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: d.activitySeeAll })).toHaveAttribute(
      "href",
      "/settings?tab=account",
    );
  });
});
