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
import {
  markReported,
  useApiError,
  useSaveFailureMessage,
  wasReported,
} from "@/lib/utils/api-error";
import { z } from "zod";
import ptMessages from "@/messages/pt.json";

/** Shapes an error the way `apiFetch` does when a response comes back not-ok. */
function apiError(message: string, status?: number, field?: string, reason?: string): Error {
  const err = new Error(message) as Error & { status?: number; field?: string; reason?: string };
  if (status !== undefined) err.status = status;
  if (field !== undefined) err.field = field;
  if (reason !== undefined) err.reason = reason;
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

  // A 409 says only that something conflicted. Deleting a tenant with a lease is refused with a
  // reason, and "someone else changed this" would send the owner looking for someone.
  it("says why a refusal refused, from the reason the route gave", () => {
    const kept = (reason: string) => messageFor(apiError("kept", 409, undefined, reason));
    expect(kept("tenant_has_history")).toBe(api.tenantHasHistory);
    expect(kept("property_has_history")).toBe(api.propertyHasHistory);
    expect(kept("lease_has_history")).toBe(api.leaseHasHistory);
  });

  it("falls back to the status for a reason it has no sentence for", () => {
    expect(messageFor(apiError("x", 409, undefined, "something_new"))).toBe(api.conflict);
    // Not an inherited property either: a Map lookup, not an object's.
    expect(messageFor(apiError("x", 409, undefined, "constructor"))).toBe(api.conflict);
  });
});

/**
 * One toast per failed save. The entity actions toast every failure and rethrow, so the screen can
 * still react; the screen's own `catch` used to toast the same failure a second time, generically
 * and in English. The mark is how a `catch` downstream can tell.
 */
describe("markReported / wasReported", () => {
  it("marks the error itself, so it still reaches the caller unchanged", () => {
    const err = apiError("Internal server error", 500);

    expect(markReported(err)).toBe(err);
    expect(wasReported(err)).toBe(true);
    expect((err as Error & { status?: number }).status).toBe(500);
  });

  it("does not treat an unmarked error, or a thrown non-object, as reported", () => {
    expect(wasReported(new Error("x"))).toBe(false);
    expect(wasReported("x")).toBe(false);
    expect(wasReported(null)).toBe(false);
  });
});

function FailureProbe({ err }: { err: unknown }) {
  const failure = useSaveFailureMessage();
  return <p data-testid="msg">{String(failure(err))}</p>;
}

function failureFor(err: unknown): string {
  const { unmount } = renderWithProviders(<FailureProbe err={err} />, { initialLocale: "pt" });
  const text = screen.getByTestId("msg").textContent ?? "";
  unmount();
  return text;
}

describe("useSaveFailureMessage", () => {
  it("asks the user to check the form when the form's own schema refused it", () => {
    const zodError = z.object({ name: z.string() }).safeParse({}).error;

    expect(failureFor(zodError)).toBe(api.invalidInput);
  });

  it("says nothing more about a failure the action already reported", () => {
    expect(failureFor(markReported(apiError("Internal server error", 500)))).toBe("null");
  });

  it("reports anything else once, in the user's language rather than the error's", () => {
    const message = failureFor(new TypeError("contractFile.arrayBuffer is not a function"));

    expect(message).toBe(api.generic);
  });
});
