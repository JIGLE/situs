import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { within } from "@testing-library/dom";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import pt from "@/messages/pt.json";
import type { BankConnectionRow } from "@/lib/hooks/use-bank-connections";

/**
 * Settings › Integrações › Bancos: each connection's menu and what it does. Asserted in
 * Portuguese, as every copy test here is, because asserting English cannot catch hardcoded
 * English. What the server allows is its own business (`canRenew`, `canDisconnect`, `canRemove`);
 * this checks that the panel shows exactly that and says what happened.
 */

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock("@/lib/utils/api-client", () => ({ apiFetch: apiFetchMock }));
vi.mock("@/lib/contexts/csrf-context", () => ({ useCsrf: () => ({ token: "csrf-token" }) }));

import { BankConnectPanel } from "./bank-connect-panel";

const panel = pt.settings.panel;
const api = pt.errors.api;

function row(overrides: Partial<BankConnectionRow> = {}): BankConnectionRow {
  return {
    id: "conn-1",
    provider: "psd2_enablebanking",
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
    movements: 12,
    canRemove: false,
    ...overrides,
  };
}

const manual = (overrides: Partial<BankConnectionRow> = {}) =>
  row({
    id: "conn-manual",
    provider: "manual",
    institutionName: "Manual import",
    isProvider: false,
    canSync: false,
    remainingBudget: null,
    canRenew: false,
    canDisconnect: false,
    revocable: false,
    ...overrides,
  });

/** An error as `apiFetch` throws it: the status, and the refusal's reason when there is one. */
function refused(status: number, reason?: string): Error {
  return Object.assign(new Error("refused"), { status, reason });
}

function show(connections: BankConnectionRow[]) {
  const onRefresh = vi.fn();
  render(
    <BankConnectPanel
      connections={connections}
      providersConfigured={["enablebanking"]}
      loading={false}
      onRefresh={onRefresh}
    />,
    { initialLocale: "pt" },
  );
  return { user: userEvent.setup(), onRefresh };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: `Ações para ${name}` }));
}

const menuItems = async () =>
  (await screen.findAllByRole("menuitem")).map((item: HTMLElement) => item.textContent?.trim());

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/settings?tab=integrations");
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("BankConnectPanel — each connection", () => {
  it("shows the owner's name with the bank's under it, and a manual row in Portuguese", () => {
    show([row({ label: "Conta da casa" }), manual()]);

    expect(screen.getByText("Conta da casa")).toBeInTheDocument();
    expect(screen.getByText("Banco BPI")).toBeInTheDocument();
    expect(screen.getByText(panel.bankManualName)).toBeInTheDocument();
    expect(screen.queryByText("Manual import")).not.toBeInTheDocument();
  });

  it("offers a live connection with movements everything but removal", async () => {
    const { user } = show([row()]);

    await openMenu(user, "Banco BPI");

    expect(await menuItems()).toEqual([panel.bankRename, panel.bankRenew, panel.bankDisconnect]);
  });

  it("offers a manual connection with movements only a new name", async () => {
    const { user } = show([manual()]);

    await openMenu(user, panel.bankManualName);

    expect(await menuItems()).toEqual([panel.bankRename]);
  });

  it("offers removal only for a connection that brought no movements", async () => {
    const { user } = show([row({ movements: 0, canRemove: true })]);

    await openMenu(user, "Banco BPI");

    expect(await menuItems()).toContain(panel.bankRemove);
  });

  it("reads a disconnected connection as Desligada, without a consent date", () => {
    show([
      row({
        status: "revoked",
        canSync: false,
        consentExpiresAt: "2026-09-27T12:00:00.000Z",
      }),
    ]);

    expect(screen.getByText(panel.bankStatus.revoked)).toBeInTheDocument();
    expect(screen.queryByText(/Consentimento válido até/)).not.toBeInTheDocument();
  });
});

describe("BankConnectPanel — renaming", () => {
  it("renames through a dialog that starts from the current name", async () => {
    apiFetchMock.mockResolvedValue({ connectionId: "conn-1", label: "Conta ordenado" });
    const { user, onRefresh } = show([row({ label: "Conta da casa" })]);

    await openMenu(user, "Conta da casa");
    await user.click(await screen.findByRole("menuitem", { name: panel.bankRename }));
    const input = await screen.findByLabelText(panel.bankRenameLabel);
    expect(input).toHaveValue("Conta da casa");
    await user.clear(input);
    await user.type(input, "Conta ordenado");
    await user.click(screen.getByRole("button", { name: pt.actions.save }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/bank/connections/conn-1",
      "csrf-token",
      "PATCH",
      {
        label: "Conta ordenado",
      },
    );
    expect(await screen.findByText(panel.bankRenamed)).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalled();
  });

  it("sends an empty name, which goes back to the bank's", async () => {
    apiFetchMock.mockResolvedValue({ connectionId: "conn-1", label: null });
    const { user } = show([row({ label: "Conta da casa" })]);

    await openMenu(user, "Conta da casa");
    await user.click(await screen.findByRole("menuitem", { name: panel.bankRename }));
    await user.clear(await screen.findByLabelText(panel.bankRenameLabel));
    await user.click(screen.getByRole("button", { name: pt.actions.save }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/bank/connections/conn-1",
      "csrf-token",
      "PATCH",
      { label: "" },
    );
  });

  it("keeps the dialog open on a refused name, and says why in Portuguese", async () => {
    apiFetchMock.mockRejectedValue(refused(400));
    const { user } = show([row()]);

    await openMenu(user, "Banco BPI");
    await user.click(await screen.findByRole("menuitem", { name: panel.bankRename }));
    await user.type(await screen.findByLabelText(panel.bankRenameLabel), "Conta");
    await user.click(screen.getByRole("button", { name: pt.actions.save }));

    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(api.invalidInput);
  });
});

describe("BankConnectPanel — renewing", () => {
  it("renews an expired connection instead of connecting a new one", async () => {
    // A hash, so jsdom can follow it: the bank's page is another origin in real life.
    apiFetchMock.mockResolvedValue({ connectionId: "conn-1", url: "#authorise" });
    const { user } = show([row({ status: "expired", canSync: false })]);

    await user.click(screen.getByRole("button", { name: panel.bankRenew }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/bank/connections/conn-1/renew",
      "csrf-token",
      "POST",
    );
    expect(window.location.hash).toBe("#authorise");
  });

  it("says why a renewal cannot start", async () => {
    apiFetchMock.mockRejectedValue(refused(409, "bank_connection_renewal_unavailable"));
    const { user } = show([row()]);

    await openMenu(user, "Banco BPI");
    await user.click(await screen.findByRole("menuitem", { name: panel.bankRenew }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      api.bankConnectionRenewalUnavailable,
    );
  });

  it("says so when the bank sends the owner back from a renewal", async () => {
    window.history.replaceState({}, "", "/settings?tab=integrations&bank=renewed");
    const { onRefresh } = show([row()]);

    expect(await screen.findByText(panel.bankRenewed)).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalled();
    expect(window.location.search).toBe("?tab=integrations");
  });
});

describe("BankConnectPanel — disconnecting", () => {
  async function disconnect(connection: BankConnectionRow, revocation: string) {
    apiFetchMock.mockResolvedValue({ connectionId: connection.id, revocation });
    const { user, onRefresh } = show([connection]);

    await openMenu(user, "Banco BPI");
    await user.click(await screen.findByRole("menuitem", { name: panel.bankDisconnect }));
    const dialog = await screen.findByRole("alertdialog");
    const description = within(dialog).getByText(/Deixa de sincronizar/).textContent;
    await user.click(within(dialog).getByRole("button", { name: panel.bankDisconnect }));
    return { description, onRefresh };
  }

  it("asks first, saying what stays, then says the bank ended its access", async () => {
    const { description, onRefresh } = await disconnect(row(), "revoked");

    expect(description).toBe(panel.bankDisconnectBody);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/bank/connections/conn-1/disconnect",
      "csrf-token",
      "POST",
    );
    expect(await screen.findByText(panel.bankDisconnected)).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalled();
  });

  it("says so when the bank did not confirm", async () => {
    await disconnect(row(), "failed");

    expect(await screen.findByText(panel.bankDisconnectedUnconfirmed)).toBeInTheDocument();
  });

  it("tells the owner of an older connection that the bank's access ends on its own date", async () => {
    const { description } = await disconnect(row({ revocable: false }), "no_consent_id");

    expect(description).toBe(panel.bankDisconnectBodyLocal);
    expect(await screen.findByText(panel.bankDisconnectedLocal)).toBeInTheDocument();
  });
});

describe("BankConnectPanel — removing", () => {
  async function remove() {
    const { user, onRefresh } = show([row({ movements: 0, canRemove: true })]);

    await openMenu(user, "Banco BPI");
    await user.click(await screen.findByRole("menuitem", { name: panel.bankRemove }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(panel.bankRemoveBody)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: panel.bankRemove }));
    return { onRefresh };
  }

  it("removes an empty connection after asking", async () => {
    apiFetchMock.mockResolvedValue({ connectionId: "conn-1", revocation: "revoked" });

    const { onRefresh } = await remove();

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/bank/connections/conn-1",
      "csrf-token",
      "DELETE",
    );
    expect(await screen.findByText(panel.bankRemoved)).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalled();
  });

  it("says why when movements arrived meanwhile", async () => {
    apiFetchMock.mockRejectedValue(refused(409, "bank_connection_has_movements"));

    await remove();

    expect(await screen.findByRole("alert")).toHaveTextContent(api.bankConnectionHasMovements);
  });
});
