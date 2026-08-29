"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/shared/error-boundary";

export const dynamic = "force-dynamic";

/**
 * NextAuth's configured error page (`pages.error` in `lib/services/auth/auth.ts`).
 *
 * It used to say the same thing whatever had happened: a hardcoded
 * `Error: OAuthAccountNotLinked`, the sentence "This is usually temporary", and a Try Again
 * button. On this app that is wrong in the most common case. Registration is closed by default
 * — the `signIn` callback returns `false` for any address the owner has not allowed — and
 * NextAuth turns that into `?error=AccessDenied`. So the person most likely to reach this page
 * was told their permanent refusal was a temporary linking glitch, and invited to retry
 * something that can never succeed.
 *
 * The page now reads the code NextAuth actually sent and says what it means, including whether
 * retrying is worth anything. `RETRYABLE` is what drives the button rather than a guess at the
 * copy: an error whose fix is "ask the instance owner" should not offer an action that loops.
 */
const KNOWN_ERRORS = {
  AccessDenied: "accessDenied",
  Configuration: "configuration",
  OAuthAccountNotLinked: "notLinked",
  Verification: "verification",
} as const;

/** Codes where trying again can plausibly succeed. The others need someone to change something. */
const RETRYABLE = new Set(["Verification", "OAuthSignin", "OAuthCallback", "Callback", "Default"]);

function AuthErrorContent() {
  const t = useTranslations("authError");
  const code = useSearchParams().get("error") ?? "Default";
  const key = KNOWN_ERRORS[code as keyof typeof KNOWN_ERRORS];
  const canRetry = !key || RETRYABLE.has(code);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--color-destructive)]/20 bg-[var(--color-card)] p-6">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-error-muted)]">
          <AlertTriangle className="h-6 w-6 text-[var(--color-destructive)]" />
        </div>

        <h1 className="text-center text-xl font-semibold text-[var(--color-foreground)]">
          {key ? t(`${key}Title`) : t("genericTitle")}
        </h1>
        <p className="mt-2 text-center text-sm text-[var(--color-muted-foreground)]">
          {key ? t(`${key}Body`) : t("genericBody")}
        </p>

        <div className="mt-6 space-y-3">
          {canRetry && (
            <Button
              className="w-full"
              onClick={() => (window.location.href = "/api/auth/signin/google")}
            >
              {t("tryAgain")}
            </Button>
          )}
          <Button variant="outline" className="w-full" onClick={() => (window.location.href = "/")}>
            {t("goHome")}
          </Button>
        </div>

        {/* The code, verbatim and unglossed — it is what an instance owner needs in order to
            look the failure up, and inventing a friendlier name for it would only make the
            support conversation longer. */}
        <details className="mt-6">
          <summary className="cursor-pointer text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
            {t("details")}
          </summary>
          <p className="mt-2 rounded bg-[var(--color-muted)] p-3 font-mono text-xs text-[var(--color-muted-foreground)]">
            {t("codeLabel")}: {code}
          </p>
        </details>
      </div>
    </div>
  );
}

export default function AuthError() {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={<div className="min-h-screen bg-[var(--color-background)]" aria-busy="true" />}
      >
        <AuthErrorContent />
      </Suspense>
    </ErrorBoundary>
  );
}
