import { beforeEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";

/**
 * The overview's Access panel, in Portuguese: the sentence that says whether a stranger can make an
 * account, how it is tinted, and where its detail link goes.
 *
 * The panel used to know two states, closed and open, and said "Registo fechado" while Google
 * sign-up was on. It reads the four states `getSignInStatus` derives, and every one is checked here
 * so a state added there without a sentence here shows as a failure instead of as the wrong one.
 */

// The bank workbench has its own routes and its own tests; this file is about the Access panel.
vi.mock("./bank-test-panel", () => ({ BankTestPanel: () => null }));

import { AdminControlCenter } from "./admin-control-center";

type Registration = "open_bootstrap" | "google" | "invitations" | "closed";

function status(registration: Registration) {
  return {
    providers: [
      { key: "credentials", configured: true },
      { key: "google", configured: true },
    ],
    registration,
    pendingInvitations: 2,
    totalAccounts: 2,
    adminAccounts: 1,
    allowlist: [],
  };
}

const reply = (body: unknown) =>
  ({ ok: true, status: 200, statusText: "", json: async () => body }) as Response;

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminControlCenter: the Access panel", () => {
  it.each<[Registration, string, "success" | "warning"]>([
    ["closed", "Registo fechado", "success"],
    ["invitations", "O registo é por convite", "success"],
    ["google", "O registo está aberto a contas Google", "warning"],
    ["open_bootstrap", "Registo aberto", "warning"],
  ])(
    "says %s, and tints it by whether a stranger can get in",
    async (registration, sentence, tone) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) =>
          // The status panel is not what is under test; it reads as unavailable.
          reply(
            String(input) === "/api/admin/sign-in-status" ? { data: status(registration) } : {},
          ),
        ),
      );

      render(<AdminControlCenter />, { initialLocale: "pt" });

      const fact = await screen.findByText(sentence);
      expect(fact).toHaveClass(`text-[var(--semantic-${tone}-readable)]`);
      // The longest of these ran past its box at 390px: the value wraps instead of being cut off.
      expect(fact.parentElement).toHaveClass("break-words");
      // The panel is titled like the tab it summarises, and its detail link opens that tab.
      const panel = fact.closest("section") as HTMLElement;
      expect(within(panel).getByRole("heading", { name: "Acessos" })).toBeInTheDocument();
      expect(within(panel).getByRole("link", { name: /Detalhe/ })).toHaveAttribute(
        "href",
        "/admin/access",
      );
    },
  );
});
