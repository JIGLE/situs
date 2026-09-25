import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { within } from "@testing-library/dom";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import { formatEuro } from "@/lib/utils/currency";
import { YearlyRentMatrix } from "./yearly-rent-matrix";

/**
 * The rent matrix answers "who has paid", in the owner's language. It spoke in English codes
 * (PAID, OVDU) and English month names, and its amounts showed only on mouse hover. Now each
 * month is a button that reads its status and amounts to a screen reader and opens the month,
 * where **Registar pagamento** starts from what is still owed.
 */

const { nav, app } = vi.hoisted(() => ({
  nav: { search: "", params: new URLSearchParams() },
  app: { addReceipt: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    if (nav.params.toString() !== nav.search) nav.params = new URLSearchParams(nav.search);
    return nav.params;
  },
}));
vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      leases: [
        {
          id: "lease-1",
          tenantId: "tenant-1",
          propertyId: "prop-1",
          status: "active",
          monthlyRent: 800,
        },
      ],
      tenants: [{ id: "tenant-1", name: "Ana Costa" }],
      properties: [{ id: "prop-1", name: "Rua Augusta 12" }],
    },
    addReceipt: app.addReceipt,
  }),
}));
vi.mock("@/lib/contexts/toast-context", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const cell = (status: string, allocatedAmount: number) => ({
  status,
  dueAmount: 800,
  allocatedAmount,
  outstanding: Math.max(0, 800 - allocatedAmount),
});

const MATRIX = {
  year: 2026,
  rows: [
    {
      leaseId: "lease-1",
      tenantId: "tenant-1",
      propertyId: "prop-1",
      tenantName: "Ana Costa",
      propertyName: "Rua Augusta 12",
      leaseStatus: "active",
      months: {
        7: cell("paid", 800),
        8: cell("partially_paid", 500),
        9: cell("overdue", 0),
        10: cell("upcoming", 0),
      },
      totals: { expected: 3200, received: 1300 },
    },
  ],
  totals: {
    expected: 3200,
    received: 1300,
    months: {
      7: { expected: 800, received: 800 },
      8: { expected: 800, received: 500 },
      9: { expected: 800, received: 0 },
      10: { expected: 800, received: 0 },
    },
  },
};

const MONTH = {
  lease: {
    id: "lease-1",
    tenantId: "tenant-1",
    propertyId: "prop-1",
    tenantName: "Ana Costa",
    propertyName: "Rua Augusta 12",
    status: "active",
    monthlyRent: 800,
  },
  period: {
    year: 2026,
    month: 8,
    status: "partially_paid",
    dueDate: "2026-08-01T00:00:00.000Z",
    dueAmount: 800,
    allocatedAmount: 500,
    outstanding: 300,
    paidAt: null,
  },
  payments: [
    {
      amount: 500,
      allocatedAt: "2026-08-04T09:00:00.000Z",
      receipt: {
        id: "receipt-1",
        date: "2026-08-04",
        amount: 500,
        lifecycle: "emitted",
        source: "manual",
      },
    },
  ],
  olderUnpaid: null as { year: number; month: number } | null,
};

let monthResponse: { status: number; body: unknown };
const fetchMock = vi.fn(async (url: string) => {
  const { status, body } = url.startsWith("/api/finance/rent-matrix/month")
    ? monthResponse
    : { status: 200, body: { data: MATRIX } };
  return { ok: status < 400, status, json: async () => body };
});

function render() {
  renderWithProviders(<YearlyRentMatrix />, { initialLocale: "pt" });
  return userEvent.setup();
}

describe("YearlyRentMatrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Only the clock: promises and timers stay real for the user events.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-25T12:00:00.000Z") });
    vi.stubGlobal("fetch", fetchMock);
    nav.search = "";
    window.history.replaceState(null, "", "/financials?tab=rent-matrix");
    monthResponse = { status: 200, body: { data: MONTH } };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("names the months in Portuguese and explains each colour in words", async () => {
    render();

    expect(await screen.findByText("Ana Costa")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "jan." })).toBeInTheDocument();
    // This month is marked, for the eye and for a screen reader.
    expect(screen.getByRole("columnheader", { name: "set." })).toHaveAttribute(
      "aria-current",
      "date",
    );
    const legend = within(screen.getByRole("list"));
    for (const label of ["Pago", "Parcialmente pago", "Em atraso", "A pagar", "Por vencer"]) {
      expect(legend.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText(/^(PAID|OVDU|PART|Jan|Sep)$/)).not.toBeInTheDocument();
  });

  it("reads each month's status and amounts, and shows what a part-paid month still owes", async () => {
    render();

    const august = await screen.findByRole("button", {
      name: `agosto de 2026: Parcialmente pago, pagos ${formatEuro(500)} de ${formatEuro(800)}`,
    });
    expect(august).toHaveTextContent("€300");
    const july = screen.getByRole("button", {
      name: `julho de 2026: Pago, pagos ${formatEuro(800)} de ${formatEuro(800)}`,
    });
    expect(july).not.toHaveTextContent("€");
    expect(screen.getByRole("button", { name: /^setembro de 2026: Em atraso/ })).toHaveTextContent(
      "€800",
    );
    // A month not yet due owes nothing today.
    expect(
      screen.getByRole("button", { name: /^outubro de 2026: Por vencer/ }),
    ).not.toHaveTextContent("€");
  });

  it("links the tenant to the lease, and adds up what was received against what was due", async () => {
    render();

    expect(await screen.findByRole("link", { name: /Ana Costa/ })).toHaveAttribute(
      "href",
      "/leases/lease-1",
    );
    expect(screen.getByRole("rowheader", { name: "Recebido" })).toBeInTheDocument();
    // The lease's year and the whole year, received of expected.
    expect(screen.getAllByText(`de ${formatEuro(3200)}`)).toHaveLength(2);
  });

  it("opens a month from its cell, and records a payment filled in with what is owed", async () => {
    const user = render();

    await user.click(await screen.findByRole("button", { name: /^agosto de 2026/ }));

    const sheet = await screen.findByRole("dialog", { name: "Ana Costa · agosto de 2026" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/finance/rent-matrix/month?leaseId=lease-1&year=2026&month=8",
      expect.anything(),
    );
    expect(new URLSearchParams(window.location.search).get("month")).toBe("lease-1:2026-08");
    const figures = within(sheet);
    expect(await figures.findByText("Em falta")).toBeInTheDocument();
    expect(figures.getByText(formatEuro(300))).toBeInTheDocument();
    // The payment that part-paid it, with its receipt's stage.
    expect(figures.getByText(/Emitido/)).toBeInTheDocument();

    await user.click(figures.getByRole("button", { name: "Registar pagamento" }));

    const dialog = await screen.findByRole("dialog", { name: "Registar pagamento" });
    expect(within(dialog).getByLabelText("Valor (€)")).toHaveValue("300");
  });

  it("takes the month off the address when it closes, and keeps the tab", async () => {
    const user = render();

    await user.click(await screen.findByRole("button", { name: /^agosto de 2026/ }));
    await screen.findByRole("dialog", { name: "Ana Costa · agosto de 2026" });
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("month")).toBeNull();
    });
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("rent-matrix");
  });

  it("opens the month named in the address", async () => {
    nav.search = "tab=rent-matrix&month=lease-1:2026-08";
    render();

    expect(
      await screen.findByRole("dialog", { name: "Ana Costa · agosto de 2026" }),
    ).toBeInTheDocument();
  });

  it("says a new payment settles an older unpaid month first", async () => {
    monthResponse = {
      status: 200,
      body: { data: { ...MONTH, olderUnpaid: { year: 2026, month: 6 } } },
    };
    nav.search = "month=lease-1:2026-08";
    render();

    expect(
      await screen.findByText(
        "Um pagamento registado agora cobre primeiro junho de 2026, o mês mais antigo por pagar.",
      ),
    ).toBeInTheDocument();
  });

  it("offers no payment for a month that is paid", async () => {
    monthResponse = {
      status: 200,
      body: {
        data: {
          ...MONTH,
          period: { ...MONTH.period, status: "paid", allocatedAmount: 800, outstanding: 0 },
        },
      },
    };
    nav.search = "month=lease-1:2026-08";
    render();

    const sheet = await screen.findByRole("dialog", { name: /agosto de 2026/ });
    expect(await within(sheet).findByText("Em falta")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Registar pagamento" })).toBeNull();
  });

  it("says in Portuguese when the month cannot be read", async () => {
    monthResponse = { status: 404, body: { error: "Lease not found" } };
    nav.search = "month=lease-9:2026-08";
    render();

    expect(await screen.findByText(ptMessages.errors.api.notFound)).toBeInTheDocument();
    expect(screen.queryByText(/Lease not found/)).not.toBeInTheDocument();
  });
});
