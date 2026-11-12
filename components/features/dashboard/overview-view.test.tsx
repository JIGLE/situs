import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { within } from "@testing-library/dom";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import pt from "@/messages/pt.json";
import type { DashboardMonth } from "@/lib/services/dashboard/month";
import { formatDate } from "@/lib/utils/format-date";

/**
 * The dashboard: the month's figures, the inbox, who is late, and what else waits. Asserted in
 * Portuguese, because asserting English cannot catch hardcoded English. The figures themselves are
 * the server's (lib/services/dashboard/month and its tests); the inbox has its own tests
 * (home-inbox.test.tsx). This checks that the screen says them, links them and moves between
 * months.
 */

const { apiFetchMock, nothingSetUp } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  nothingSetUp: { value: false },
}));

vi.mock("@/lib/utils/api-client", () => ({ apiFetch: apiFetchMock }));
vi.mock("@/lib/contexts/csrf-context", () => ({ useCsrf: () => ({ token: "csrf" }) }));
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
      properties: nothingSetUp.value ? [] : [{ id: "p1", name: "T2 Lisboa", status: "occupied" }],
      tenants: [{ id: "t1", name: "Ana Silva" }],
      leases: [{ id: "l1" }],
      receipts: [{ id: "r1" }],
      expenses: [],
      loading: false,
    },
    refreshData: vi.fn(),
  }),
}));

import { OverviewView } from "./overview-view";

const d = pt.dashboard;

function month(overrides: Partial<DashboardMonth> = {}): DashboardMonth {
  return {
    year: 2026,
    month: 8,
    figures: { expected: 1850, received: 950, outstanding: 900 },
    late: [],
    tenancies: [
      {
        leaseId: "lease-1",
        tenantName: "Ana Martínez",
        propertyName: "Rua Augusta 12",
        status: "paid",
        dueDate: "2026-08-08T00:00:00.000Z",
        dueAmount: 950,
        allocatedAmount: 950,
        paidAt: "2026-08-03T00:00:00.000Z",
      },
      {
        leaseId: "lease-2",
        tenantName: "Carlos Gómez",
        propertyName: "Rua do Ouro 3",
        status: "overdue",
        dueDate: "2026-08-08T00:00:00.000Z",
        dueAmount: 900,
        allocatedAmount: 0,
        paidAt: null,
      },
    ],
    yearTotals: { received: 7600, expenses: 400 },
    upcoming: [],
    attention: { leasesEnding: 0, missingData: 0 },
    status: { bank: null, taxMode: "sandbox" },
    ...overrides,
  };
}

function show(answer: DashboardMonth = month(), search = "?month=2026-08") {
  window.history.replaceState({}, "", `/dashboard${search}`);
  // The month for the month; the inbox's movements are its own tests'.
  apiFetchMock.mockImplementation(async (url: string) =>
    url.startsWith("/api/dashboard/month") ? answer : [],
  );
  render(<OverviewView />, { initialLocale: "pt" });
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  nothingSetUp.value = false;
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("OverviewView — the heading", () => {
  it("is the page's h1 before anything is set up, when the top bar is not a heading", async () => {
    nothingSetUp.value = true;
    show();

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      /^(Bom dia|Boa tarde|Boa noite), José$/,
    );
  });
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

    await user.click(await screen.findByRole("button", { name: d.previousMonth }));

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

    await screen.findByTestId("dashboard-month-block");
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/dashboard/month?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
    );
  });

  it("says how much of the month arrived, and what is still owed", async () => {
    show();

    expect(await screen.findByTestId("dashboard-figures")).toHaveTextContent("950 € de 1850 €");
    expect(screen.getByText("900 € em falta")).toBeInTheDocument();
  });

  it("lists the month by tenancy, each opening its month in the rent map", async () => {
    show();

    const block = await screen.findByTestId("dashboard-month-block");
    const paid = within(block).getByRole("link", { name: /Ana Martínez/ });
    expect(paid).toHaveTextContent(pt.rentPeriodStatus.paid);
    expect(paid).toHaveTextContent("Pago a");
    expect(paid).toHaveAttribute("href", "/financials?tab=ledger&month=lease-1:2026-08");
    const late = within(block).getByRole("link", { name: /Carlos Gómez/ });
    expect(late).toHaveTextContent(pt.rentPeriodStatus.overdue);
    expect(late).toHaveTextContent("Em atraso desde");
  });

  it("says when a month has no rent", async () => {
    show(month({ tenancies: [], figures: { expected: 0, received: 0, outstanding: 0 } }));

    expect(await screen.findByText(d.monthEmpty)).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-figures")).not.toBeInTheDocument();
  });

  it("says the year so far in one line", async () => {
    show();

    expect(await screen.findByTestId("dashboard-year")).toHaveTextContent(
      "2026: 7600 € recebidos · 400 € despesas · 7200 € líquido",
    );
  });

  it("says why the month could not be read", async () => {
    window.history.replaceState({}, "", "/dashboard?month=2026-08");
    apiFetchMock.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    render(<OverviewView />, { initialLocale: "pt" });

    expect(await screen.findByRole("alert")).toHaveTextContent(pt.errors.api.serverError);
  });
});

describe("OverviewView — the inbox and who is late", () => {
  it("shows the inbox under the figures", async () => {
    show();

    expect(await screen.findByTestId("home-inbox")).toHaveTextContent(d.inbox.empty);
  });

  it("lists who is late, by how much and since when, each opening the oldest month owed", async () => {
    show(
      month({
        late: [
          {
            leaseId: "lease-1",
            tenantName: "Ana Martínez",
            propertyName: "Rua Augusta 12",
            months: 2,
            amount: 1500,
            since: "2026-06",
          },
        ],
      }),
    );

    const list = await screen.findByTestId("dashboard-late");
    const row = within(list).getByRole("link", { name: /Ana Martínez/ });
    expect(row).toHaveTextContent("Rua Augusta 12 · 2 meses em dívida desde junho de 2026");
    expect(row).toHaveTextContent("1500 €");
    expect(row).toHaveAttribute("href", "/financials?tab=ledger&month=lease-1:2026-06");
  });

  it("shows no late list when nobody owes", async () => {
    show();

    await screen.findByTestId("home-inbox");
    expect(screen.queryByTestId("dashboard-late")).not.toBeInTheDocument();
  });
});

describe("OverviewView — what waits", () => {
  it("lists only what waits, each opening where it is dealt with", async () => {
    show(month({ attention: { leasesEnding: 1, missingData: 4 } }));

    const list = await screen.findByTestId("dashboard-attention");
    expect(within(list).getByText(d.attentionTitle)).toBeInTheDocument();
    // Contracts reaching their term are under "A seguir", with their dates.
    expect(within(list).queryByRole("link", { name: /contrato/ })).not.toBeInTheDocument();
    // What a receipt still needs from the owner opens the guided list, one field at a time.
    expect(
      within(list).getByRole("link", { name: "Faltam 4 dados para os seus recibos" }),
    ).toHaveAttribute("href", "/complete");
  });

  it("says a single missing field in the singular", async () => {
    show(
      month({
        attention: { ...month().attention, missingData: 1 },
      }),
    );

    const list = await screen.findByTestId("dashboard-attention");
    expect(
      within(list).getByRole("link", { name: "Falta 1 dado para os seus recibos" }),
    ).toBeInTheDocument();
  });

  it("shows no list when nothing waits", async () => {
    show();

    await screen.findByTestId("home-inbox");
    expect(screen.queryByTestId("dashboard-attention")).not.toBeInTheDocument();
    expect(screen.queryByText(d.attentionTitle)).not.toBeInTheDocument();
  });
});

describe("OverviewView — what comes next", () => {
  it("lists rent due, rent increases and contracts reaching their term, each opening the lease", async () => {
    show(
      month({
        upcoming: [
          {
            kind: "rent",
            date: "2026-09-08T00:00:00.000Z",
            leaseId: "lease-1",
            tenantName: "Ana Martínez",
            amount: 950,
          },
          {
            kind: "increase",
            date: "2026-10-01T00:00:00.000Z",
            leaseId: "lease-2",
            tenantName: "Carlos Gómez",
            previousRent: 900,
            newRent: 920,
          },
          {
            kind: "leaseEnd",
            date: "2026-10-31T00:00:00.000Z",
            leaseId: "lease-1",
            tenantName: "Ana Martínez",
            autoRenew: true,
          },
        ],
      }),
    );

    const list = await screen.findByTestId("dashboard-upcoming");
    expect(within(list).getByText(d.upcomingTitle)).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: /Renda de Ana Martínez/ })).toHaveAttribute(
      "href",
      "/portfolio?tab=leases&detail=lease:lease-1",
    );
    expect(
      within(list).getByRole("link", { name: /Aumento da renda de Carlos Gómez/ }),
    ).toHaveTextContent("900 € → 920 €");
    // Jose's contracts renew by themselves: one that does says so rather than "ends".
    expect(within(list).getByText("Contrato de Ana Martínez renova-se")).toBeInTheDocument();
  });

  it("shows no list when nothing comes up", async () => {
    show();
    await screen.findByTestId("home-inbox");
    expect(screen.queryByTestId("dashboard-upcoming")).not.toBeInTheDocument();
  });
});

describe("OverviewView — the status line", () => {
  it("says nothing when there is no bank", async () => {
    show();
    await screen.findByTestId("home-inbox");
    expect(screen.queryByTestId("dashboard-status")).not.toBeInTheDocument();
  });

  it("names the bank and when it last synced, while it works", async () => {
    show(
      month({
        status: {
          bank: {
            name: "Millennium BCP",
            lastSyncAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            consentEndsAt: null,
            expired: false,
          },
          taxMode: "test",
        },
      }),
    );

    const line = await screen.findByTestId("dashboard-status");
    expect(line).toHaveTextContent("Millennium BCP · sincronizado há 2 horas");
    expect(line).toHaveAttribute("href", "/settings?tab=integrations");
  });

  it("warns before the bank's consent ends, with the way to renew it", async () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    show(
      month({
        status: {
          bank: {
            name: "Millennium BCP",
            lastSyncAt: "2026-09-27T06:00:00.000Z",
            consentEndsAt: soon,
            expired: false,
          },
          taxMode: "test",
        },
      }),
    );

    const line = await screen.findByTestId("dashboard-status");
    expect(line).toHaveTextContent(`termina a ${formatDate(soon, "pt")}`);
    expect(line).toHaveAttribute("href", "/settings?tab=integrations");
  });

  it("says the consent has ended", async () => {
    show(
      month({
        status: {
          bank: { name: "Millennium BCP", lastSyncAt: null, consentEndsAt: null, expired: true },
          taxMode: "sandbox",
        },
      }),
    );

    expect(await screen.findByTestId("dashboard-status")).toHaveTextContent(d.statusConsentEnded);
  });
});
