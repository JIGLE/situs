/**
 * @vitest-environment jsdom
 */
/**
 * The auth error page must describe the error it was actually given.
 *
 * It used to render one hardcoded story regardless: `Error: OAuthAccountNotLinked`, "This is
 * usually temporary", and a Try Again button. Registration is closed by default on this app —
 * `signIn` returns `false` for any address the owner has not allowed, which NextAuth turns into
 * `?error=AccessDenied` — so the single most likely visitor to this page was told a permanent
 * refusal was a transient glitch and offered a retry that can never work.
 *
 * These assert Portuguese for the same reason the other copy tests do: asserting English cannot
 * catch a component that hardcodes English.
 */
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/tests/helpers/render-with-providers";
import AuthErrorPage from "@/app/auth/error/page";
import ptMessages from "@/messages/pt.json";

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

function renderWith(error: string) {
  search = error ? `error=${error}` : "";
  return renderWithProviders(<AuthErrorPage />, { initialLocale: "pt" });
}

describe("auth error page", () => {
  it("names a closed registration as closed, and offers no retry", async () => {
    renderWith("AccessDenied");

    expect(await screen.findByText(ptMessages.authError.accessDeniedTitle)).toBeInTheDocument();
    // The whole point: retrying cannot help, so the button that invites it is absent.
    expect(
      screen.queryByRole("button", { name: ptMessages.authError.tryAgain }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: ptMessages.authError.goHome })).toBeInTheDocument();
  });

  it("offers a retry for an error that a retry can fix", async () => {
    renderWith("Verification");

    expect(await screen.findByText(ptMessages.authError.verificationTitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ptMessages.authError.tryAgain })).toBeInTheDocument();
  });

  it("falls back to the generic story for an unrecognised code, and shows the code", async () => {
    renderWith("SomethingNew");

    expect(await screen.findByText(ptMessages.authError.genericTitle)).toBeInTheDocument();
    // Verbatim, because it is what an instance owner needs to look the failure up.
    expect(screen.getByText(/SomethingNew/)).toBeInTheDocument();
  });

  it("never claims a linking error it was not told about", async () => {
    renderWith("AccessDenied");
    expect(screen.queryByText(/OAuthAccountNotLinked/)).not.toBeInTheDocument();
  });
});
