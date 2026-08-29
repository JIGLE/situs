"use client";

import { useCallback } from "react";
import { useMessages, useTranslations } from "next-intl";

/**
 * Turn a failed request into a sentence the user's own language owns.
 *
 * Every route replies through `createErrorResponse`, which puts an English string in the
 * envelope's `error` field. `apiFetch` wraps that string in an `Error`, and around thirty
 * components rendered `err.message` straight into a banner or a toast — so a Portuguese user
 * doing everything right met "Failed to load bank movements" or "Database operation failed" at
 * the exact moment they were least able to guess what it meant.
 *
 * The fix needs no server change, because `apiFetch` already attaches the HTTP status to the
 * error it throws. The status carries the whole distinction that matters to a person: whether
 * to sign in again, fix the form, reload, wait, or give up and ask someone. Error codes would
 * be more precise, and precision is not what was missing.
 *
 * `field` is the one fragment of a server error worth showing, and it is why this reads two
 * namespaces rather than one: `createErrorResponse` sets it for every `ValidationError`, and
 * `forms.*` already holds a translated label for the common field names, so "o email não é
 * válido" costs no new table. A field the catalogue does not know falls back to the generic
 * sentence rather than printing a raw column name at somebody.
 */

/** Status → key under `errors.api`. Anything unlisted is a `generic`. */
const STATUS_KEY: Record<number, string> = {
  401: "signedOut",
  402: "planLimit",
  403: "notAllowed",
  404: "notFound",
  409: "conflict",
  429: "tooMany",
};

type ApiErrorShape = Error & { status?: number; field?: string };

/**
 * Build an error that remembers which HTTP status produced it.
 *
 * `apiFetch` does this already. Components that call `fetch` directly were throwing
 * `new Error(\`Request failed (${res.status})\`)` — the status baked into a string and lost as
 * data — so the resolver below could not tell a server that answered 500 from a server that
 * never answered at all, and told the user to check their connection either way.
 *
 * The message stays English on purpose: it is for the console and the logs. Nothing renders it.
 */
export function httpError(status: number, message = `Request failed (${status})`): Error {
  const err = new Error(message) as ApiErrorShape;
  err.status = status;
  return err;
}

/**
 * `(err) => string`, ready to hand to `setError` or a toast.
 *
 * A hook rather than a plain function so call sites do not each have to thread two translators.
 * For code that cannot call hooks — `create-entity-actions.ts` is a factory, not a component —
 * build it in the hook that constructs that code and pass the resolver down, the way
 * `csrfToken` is already passed.
 */
export function useApiError(): (err: unknown) => string {
  const t = useTranslations("errors.api");
  const tFields = useTranslations("forms");
  // The catalogue itself, to ask whether a field label exists before asking for it. next-intl's
  // translator throws on a missing key and this version exposes no `has`, so the alternative is
  // a hand-kept list of field names — a second copy of `forms`, free to drift from the first.
  const messages = useMessages() as Record<string, unknown> | undefined;

  // Memoized so the identity is stable across renders. Every call site sits inside a
  // `useCallback` that fetches, and an unstable resolver in those dependency arrays would
  // rebuild the fetcher on every render — a refetch loop introduced by an error helper.
  return useCallback(
    (err: unknown): string => {
      const api = err instanceof Error ? (err as ApiErrorShape) : null;
      const status = api?.status;

      // No status means the request never got an answer: a dropped connection, DNS, an aborted
      // fetch. "Something went wrong" is true but useless; naming the connection is actionable.
      if (api && status === undefined) return t("offline");

      if (status === 400 || status === 422) {
        const field = api?.field;
        if (field) {
          // A validation error naming a column this catalogue has never heard of must not take
          // the whole screen down on its way to explaining itself.
          const forms = messages?.forms as Record<string, unknown> | undefined;
          if (forms && typeof forms[field] === "string") {
            return t("invalidField", { field: tFields(field) });
          }
        }
        return t("invalidInput");
      }

      if (status !== undefined && status >= 500) return t("serverError");

      const key = status !== undefined ? STATUS_KEY[status] : undefined;
      return t(key ?? "generic");
    },
    [t, tFields, messages],
  );
}
