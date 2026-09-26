"use client";

import { useCallback } from "react";
import { useMessages, useTranslations } from "next-intl";
import { ZodError } from "zod";
import type en from "@/messages/en.json";

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
const STATUS_KEY: Partial<
  Record<number, "signedOut" | "notAllowed" | "notFound" | "conflict" | "tooMany">
> = {
  401: "signedOut",
  403: "notAllowed",
  404: "notFound",
  409: "conflict",
  429: "tooMany",
};

/**
 * A refusal's `reason` → the key under `errors.api` that explains it. A status says a request
 * conflicted; the reason says with what, which is the part a person can act on. A Map, so a reason
 * such as "constructor" finds nothing rather than an inherited property.
 */
const REASON_KEY = new Map<
  string,
  | "tenantHasHistory"
  | "propertyHasHistory"
  | "leaseHasHistory"
  | "atPasswordRequired"
  | "atCredentialsNeedKey"
  | "atFilesNotReady"
  | "atCredentialsMissing"
  | "atCredentialsUnreadable"
  | "atTestModeRequired"
  | "bankOutflowNotRent"
  | "bankLeaseRequired"
  | "bankMovementHasReceipt"
  | "bankMovementNotIgnored"
  | "receiptTransitionNotAllowed"
  | "receiptFilingMissing"
  | "receiptSubmissionRefused"
>([
  ["tenant_has_history", "tenantHasHistory"],
  ["property_has_history", "propertyHasHistory"],
  ["lease_has_history", "leaseHasHistory"],
  ["at_password_required", "atPasswordRequired"],
  ["at_credentials_need_key", "atCredentialsNeedKey"],
  ["at_files_not_ready", "atFilesNotReady"],
  ["at_credentials_missing", "atCredentialsMissing"],
  ["at_credentials_unreadable", "atCredentialsUnreadable"],
  ["at_test_mode_required", "atTestModeRequired"],
  ["bank_outflow_not_rent", "bankOutflowNotRent"],
  ["bank_lease_required", "bankLeaseRequired"],
  ["bank_movement_has_receipt", "bankMovementHasReceipt"],
  ["bank_movement_not_ignored", "bankMovementNotIgnored"],
  ["receipt_transition_not_allowed", "receiptTransitionNotAllowed"],
  ["receipt_filing_missing", "receiptFilingMissing"],
  ["receipt_submission_refused", "receiptSubmissionRefused"],
]);

type FormsCatalogue = (typeof en)["forms"];
/** A field with its own label under `forms` (not a nested group such as a sub-form's keys). */
type FormFieldKey = {
  [K in keyof FormsCatalogue]: FormsCatalogue[K] extends string ? K : never;
}[keyof FormsCatalogue];

/** Whether the catalogue has a label for this field, checked against the live messages. */
function isFormField(
  forms: Record<string, unknown> | undefined,
  field: string,
): field is FormFieldKey {
  return forms !== undefined && typeof forms[field] === "string";
}

type ApiErrorShape = Error & { status?: number; field?: string; reason?: string };

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

      const reasonKey = api?.reason ? REASON_KEY.get(api.reason) : undefined;
      if (reasonKey) return t(reasonKey);

      if (status === 400 || status === 422) {
        const field = api?.field;
        if (field) {
          // A validation error naming a column this catalogue has never heard of must not take
          // the whole screen down on its way to explaining itself.
          const forms = messages?.forms as Record<string, unknown> | undefined;
          if (isFormField(forms, field)) {
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

/**
 * One toast per failed save.
 *
 * The entity actions (`create-entity-actions.ts`) toast every failure themselves and then rethrow,
 * so the screen that called them can still react: keep a dialog open, roll a change back. Most of
 * those screens also toasted the same failure from their own `catch`, so a failed save showed two
 * toasts, and the second was usually generic and English. The actions mark what they report; a
 * `catch` further up asks `wasReported` before it says anything.
 *
 * The mark is a non-enumerable symbol on the error itself, so the error reaches the caller
 * unchanged: same object, same `status`, same message.
 */
const REPORTED = Symbol.for("situs.error.reported");

export function markReported<E>(err: E): E {
  if (err !== null && typeof err === "object" && Object.isExtensible(err)) {
    Object.defineProperty(err, REPORTED, { value: true });
  }
  return err;
}

export function wasReported(err: unknown): boolean {
  return (
    err !== null && typeof err === "object" && (err as Record<symbol, unknown>)[REPORTED] === true
  );
}

/**
 * `(err) => string | null`: what to toast when a save fails, or `null` when nothing should be.
 *
 * A `ZodError` is the form's own complaint, so it gets the "check the form" sentence. An error the
 * entity action already reported gets nothing more. Anything else is a failure nobody has reported
 * yet, and gets the generic sentence: never the error's own message, which is English written for a
 * log.
 */
export function useSaveFailureMessage(): (err: unknown) => string | null {
  const t = useTranslations("errors.api");
  return useCallback(
    (err: unknown): string | null => {
      if (err instanceof ZodError) return t("invalidInput");
      if (wasReported(err)) return null;
      return t("generic");
    },
    [t],
  );
}
