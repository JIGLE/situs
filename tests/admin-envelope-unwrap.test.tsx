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
 * and neither view had a test. These render the views against the shape `apiFetch` actually
 * hands back and assert the content reaches the screen. Restoring either `.data` fails them.
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

  it("lists the accounts apiFetch returns", async () => {
    const { AdminUsersView } = await import("@/components/features/admin/admin-users-view");

    // Exactly what `apiFetch` yields for `{"data":{"users":[…]}}` — the envelope is already off.
    apiFetch.mockResolvedValue({
      users: [
        {
          id: "u1",
          email: "owner@situs.local",
          name: "Owner",
          role: "ADMIN",
          createdAt: new Date("2026-01-02").toISOString(),
          isSelf: true,
          owns: { properties: 2, tenants: 3, leases: 1, receipts: 4 },
        },
      ],
    });

    render(<AdminUsersView />);

    await waitFor(() => {
      expect(screen.getByText("owner@situs.local")).toBeInTheDocument();
    });
    // The empty state must not be what a populated response renders.
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
  });

  it("says so when there genuinely are no accounts", async () => {
    const { AdminUsersView } = await import("@/components/features/admin/admin-users-view");
    apiFetch.mockResolvedValue({ users: [] });

    render(<AdminUsersView />);

    // A blank panel is the one rendering that hides a fault instead of reporting it: you are
    // signed in, so the list cannot legitimately be empty.
    await waitFor(() => {
      expect(screen.getByText(/No accounts found/)).toBeInTheDocument();
    });
  });

  it("renders the sign-in status apiFetch returns", async () => {
    const { AdminSignInView } = await import("@/components/features/admin/admin-sign-in-view");

    apiFetch.mockResolvedValue({
      providers: [
        { key: "credentials", configured: true },
        { key: "google", configured: false },
      ],
      registration: "closed",
      totalAccounts: 1,
      adminAccounts: 1,
      allowlist: [],
    });

    render(<AdminSignInView />);

    await waitFor(() => {
      // `loadFailed` was what this page showed on every visit, whatever the server answered.
      expect(screen.queryByText("loadFailed")).not.toBeInTheDocument();
    });
    // `registrationClosed` and the per-provider row both come from `status`, so either one
    // reaching the DOM proves the payload survived the unwrap.
    expect(screen.getByText("Registration is closed")).toBeInTheDocument();
    expect(screen.getByText("Email and password")).toBeInTheDocument();
  });
});
