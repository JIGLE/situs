import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderWithProviders as render,
  screen,
  waitFor,
} from "@/tests/helpers/render-with-providers";

/**
 * Both admin views that read through `apiFetch` unwrapped the response envelope twice.
 *
 * `apiFetch` already returns `body.data` when the response carries it, so `body?.data?.users`
 * resolved to `undefined` on every successful load. The accounts list rendered empty and the
 * access page rendered its "could not load" state — permanently, on a 200 with correct data.
 *
 * Nothing caught it: the generic was written as `{ data?: ... }`, so the double read type-checked,
 * and neither view had a test. These render the view against the shape `apiFetch` actually hands
 * back and assert the content reaches the screen. Restoring a `.data` read fails them.
 *
 * The one view left reads two routes (`/api/admin/access` and `/api/admin/sign-in-status`), so each
 * is answered with its own payload and a section of the screen proves each one arrived.
 */

const apiFetch = vi.fn();

vi.mock("@/lib/utils/api-client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

vi.mock("@/lib/contexts/csrf-context", () => ({
  useCsrf: () => ({ token: "test-csrf-token" }),
}));

// The views are translated; the harness only needs stable, distinguishable output, so keys pass
// through. That keeps the assertions on the *data*, which is what regressed.
// `next-intl` is not mocked here. It used to be, returning the key (or a small hand-written
// map of English strings) — which meant this file asserted placeholder text rather than what
// a user reads. `renderWithProviders` supplies the real provider and catalogue.

describe("admin views unwrap the API envelope exactly once", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("renders what both routes of Acessos hand back", async () => {
    const { AdminAccessView } =
      await import("@/components/features/admin/access/admin-access-view");

    apiFetch.mockImplementation(async (url: string) =>
      url === "/api/admin/access"
        ? {
            settings: { googleSignUp: false, invitations: true },
            invitations: [
              {
                id: "inv-1",
                email: "guest@example.test",
                role: "MANAGER",
                createdAt: "2026-10-01T00:00:00.000Z",
                expiresAt: "2099-10-31T00:00:00.000Z",
                expired: false,
              },
            ],
            allowlist: ["operator@example.test"],
            accounts: [
              {
                id: "acc-1",
                email: "owner@example.test",
                name: "Owner",
                role: "ADMIN",
                createdAt: "2026-09-01T00:00:00.000Z",
                self: true,
              },
            ],
          }
        : {
            providers: [
              { key: "credentials", configured: true },
              { key: "google", configured: false },
            ],
            registration: "closed",
            pendingInvitations: 1,
            totalAccounts: 1,
            adminAccounts: 1,
            allowlist: ["operator@example.test"],
          },
    );

    render(<AdminAccessView />);

    await waitFor(() => {
      // `loadFailed` was what this page showed on every visit, whatever the server answered.
      expect(screen.queryByText("Could not load the access settings.")).not.toBeInTheDocument();
    });
    // The status route: the registration sentence, the counts and the provider row.
    expect(screen.getByText("Registration is closed")).toBeInTheDocument();
    expect(screen.getByText("1 account, 1 of them an administrator.")).toBeInTheDocument();
    expect(screen.getByText("Email and password")).toBeInTheDocument();
    // The access route: an invitation, an account and the allowlist.
    expect(screen.getByText("guest@example.test")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getAllByText("operator@example.test")).not.toHaveLength(0);
  });
});
