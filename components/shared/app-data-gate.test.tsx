import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import userEvent from "@testing-library/user-event";

/**
 * The gate decides what a landlord sees while their account is loading and when it fails to.
 *
 * Before it, `state.loading` was read by 2 components out of 27 screens and `state.error` by
 * none, so both situations rendered as the EMPTY state — "No properties yet" on an account with
 * forty properties, and the same screen permanently if the fetch failed, with only an
 * auto-dismissing toast to say otherwise.
 *
 * The cases that matter are the two that stop the cure being worse than the disease: a
 * background refresh must NOT replace a populated screen with a skeleton, and an error must be
 * recoverable without a page reload.
 */

const { useAppMock, refreshDataMock } = vi.hoisted(() => ({
  useAppMock: vi.fn(),
  refreshDataMock: vi.fn(),
}));

vi.mock("@/lib/contexts/app-context", () => ({ useApp: useAppMock }));
vi.mock("next/navigation", () => ({ usePathname: () => "/en/portfolio" }));
// `next-intl` is not mocked here. It used to be, returning the key (or a small hand-written
// map of English strings) — which meant this file asserted placeholder text rather than what
// a user reads. `renderWithProviders` supplies the real provider and catalogue.

import { AppDataGate } from "./app-data-gate";

const CONTENT = "Portfolio contents";

function givenState(overrides: Record<string, unknown>) {
  useAppMock.mockReturnValue({
    state: {
      loading: false,
      error: null,
      properties: [],
      tenants: [],
      leases: [],
      ...overrides,
    },
    refreshData: refreshDataMock,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AppDataGate", () => {
  it("shows a skeleton instead of the empty state during the first load", async () => {
    givenState({ loading: true });

    render(
      <AppDataGate>
        <p>{CONTENT}</p>
      </AppDataGate>,
    );

    // The screen must not claim there is nothing here while the answer is still in flight.
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
  });

  it("keeps the populated screen during a background refresh", async () => {
    // The regression this exists to prevent. refreshData() runs after every mutation; blanking
    // a full page to a skeleton on each save would be worse than the bug being fixed.
    givenState({ loading: true, properties: [{ id: "p1" }] });

    render(
      <AppDataGate>
        <p>{CONTENT}</p>
      </AppDataGate>,
    );

    expect(screen.getByText(CONTENT)).toBeInTheDocument();
  });

  it("renders children normally once loaded", async () => {
    givenState({ properties: [{ id: "p1" }] });

    render(
      <AppDataGate>
        <p>{CONTENT}</p>
      </AppDataGate>,
    );

    expect(screen.getByText(CONTENT)).toBeInTheDocument();
  });

  it("replaces the screen with a recoverable error when the fetch failed", async () => {
    givenState({ error: "Security token expired. Please refresh the page." });

    render(
      <AppDataGate>
        <p>{CONTENT}</p>
      </AppDataGate>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    // The specific reason is shown, not a generic line: a expired-token failure and a network
    // failure need different actions from the user.
    expect(screen.getByText(/Security token expired/)).toBeInTheDocument();
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
  });

  it("offers a retry that calls refreshData rather than requiring a page reload", async () => {
    givenState({ error: "Failed to load data" });

    render(
      <AppDataGate>
        <p>{CONTENT}</p>
      </AppDataGate>,
    );
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(refreshDataMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the error visible while the retry is in flight", async () => {
    // Error wins over loading deliberately. Flicking to a skeleton would hide the fact that the
    // user's own retry is the reason anything is happening.
    givenState({ error: "Failed to load data", loading: true });

    render(
      <AppDataGate>
        <p>{CONTENT}</p>
      </AppDataGate>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /trying again/i })).toBeDisabled();
  });
});
