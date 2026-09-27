import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import type { BankConnectionRow } from "@/lib/hooks/use-bank-connections";

const { connectionsMock } = vi.hoisted(() => ({ connectionsMock: vi.fn() }));

vi.mock("@/lib/contexts/toast-context", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-bank-connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hooks/use-bank-connections")>()),
  useBankConnections: connectionsMock,
  useBankSync: () => vi.fn(),
}));

import { BankSyncStrip } from "./bank-sync-strip";

function row(overrides: Partial<BankConnectionRow>): BankConnectionRow {
  return {
    id: "conn-1",
    provider: "psd2_fake",
    institutionName: "Banco BPI",
    label: null,
    status: "active",
    lastSyncAt: null,
    consentExpiresAt: null,
    isProvider: true,
    canSync: true,
    remainingBudget: 4,
    canRenew: true,
    canDisconnect: true,
    revocable: true,
    movements: 0,
    canRemove: true,
    ...overrides,
  };
}

function withConnections(connections: BankConnectionRow[]) {
  connectionsMock.mockReturnValue({
    connections,
    providersConfigured: ["fake"],
    loading: false,
    reload: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BankSyncStrip", () => {
  it("lists the banks that sync, and leaves a disconnected one to Settings", () => {
    withConnections([
      row({ id: "conn-1", institutionName: "Banco BPI", status: "revoked", canSync: false }),
      row({ id: "conn-2", institutionName: "Banco CTT" }),
    ]);

    render(<BankSyncStrip onSynced={vi.fn()} />, { initialLocale: "pt" });

    expect(screen.getByText("Banco CTT")).toBeInTheDocument();
    expect(screen.queryByText("Banco BPI")).not.toBeInTheDocument();
  });

  it("shows the owner's name for a connection they named", () => {
    withConnections([row({ label: "Conta da casa" })]);

    render(<BankSyncStrip onSynced={vi.fn()} />, { initialLocale: "pt" });

    expect(screen.getByText("Conta da casa")).toBeInTheDocument();
    expect(screen.queryByText("Banco BPI")).not.toBeInTheDocument();
  });

  it("says no bank is connected when the only one was disconnected", () => {
    withConnections([row({ status: "revoked", canSync: false })]);

    render(<BankSyncStrip onSynced={vi.fn()} />, { initialLocale: "pt" });

    expect(screen.getByText(/Nenhum banco ligado/)).toBeInTheDocument();
    expect(screen.queryByText("Banco BPI")).not.toBeInTheDocument();
  });
});
