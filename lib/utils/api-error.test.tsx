/**
 * @vitest-environment jsdom
 */
/**
 * The failure path has to speak the user's language too.
 *
 * These assert Portuguese, for the same reason every other copy test in this repo does:
 * asserting English cannot catch a component that hardcodes English, because the hardcoded
 * string IS the expected string. The defect being pinned is a server sentence reaching the
 * screen — and the server writes English.
 */
import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/tests/helpers/render-with-providers";
import { useApiError } from "@/lib/utils/api-error";
import ptMessages from "@/messages/pt.json";

/** Shapes an error the way `apiFetch` does when a response comes back not-ok. */
function apiError(message: string, status?: number, field?: string): Error {
  const err = new Error(message) as Error & { status?: number; field?: string };
  if (status !== undefined) err.status = status;
  if (field !== undefined) err.field = field;
  return err;
}

function Probe({ err }: { err: unknown }) {
  const resolve = useApiError();
  return <p data-testid="msg">{resolve(err)}</p>;
}

/** Unmounts its own render, so a case inside a loop cannot read the previous case's output. */
function messageFor(err: unknown): string {
  const { unmount } = renderWithProviders(<Probe err={err} />, { initialLocale: "pt" });
  const text = screen.getByTestId("msg").textContent ?? "";
  unmount();
  return text;
}

const api = ptMessages.errors.api;

describe("useApiError", () => {
  it("never returns the server's own sentence", () => {
    // The whole point. `createErrorResponse` sends English; nothing it wrote may reach the user.
    const serverSaid = "Database operation failed";
    expect(messageFor(apiError(serverSaid, 500))).not.toContain(serverSaid);
  });

  it("maps each status to the sentence that tells the user what to do", () => {
    const cases: [number, string][] = [
      [401, api.signedOut],
      [402, api.planLimit],
      [403, api.notAllowed],
      [404, api.notFound],
      [409, api.conflict],
      [429, api.tooMany],
      [500, api.serverError],
      [503, api.serverError],
    ];
    for (const [status, expected] of cases) {
      expect(messageFor(apiError("Internal server error", status)), `status ${status}`).toBe(
        expected,
      );
    }
  });

  it("names the field a validation error rejected", () => {
    // `forms.email` exists, so the sentence can be specific instead of "check the form".
    const message = messageFor(apiError("Validation error", 400, "email"));
    expect(message).toContain(ptMessages.forms.email);
    expect(message).not.toContain("Validation error");
  });

  it("falls back to the generic form message for a field the catalogue does not know", () => {
    // A raw column name is not a label. Printing `ibanHash` at somebody is worse than saying
    // nothing specific, and next-intl throws on a missing key — so this must not attempt it.
    expect(messageFor(apiError("Validation error", 400, "ibanHash"))).toBe(api.invalidInput);
  });

  it("says the connection failed when there is no status at all", () => {
    // A thrown fetch never reached a server, so "something went wrong" is true but useless.
    expect(messageFor(apiError("Failed to fetch"))).toBe(api.offline);
  });

  it("falls back to generic for a non-Error value", () => {
    expect(messageFor("just a string")).toBe(api.generic);
  });
});
