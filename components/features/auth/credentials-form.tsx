"use client";

import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import type { AuthMode } from "./auth-view";

const INPUT =
  "h-12 w-full border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-base text-[var(--color-foreground)] outline-none transition-colors placeholder:text-[var(--color-muted-foreground)] focus:border-[var(--country-highlight-readable)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]";

/**
 * Email and password, for demo and self-hosted instances only (`demoLoginEnabled`, resolved on the
 * server). Always rendered when it is on: the end-to-end suite and the mobile audit sign in by
 * filling these fields, so they are not tucked behind a disclosure.
 *
 * `text-base` (16px) keeps iOS from zooming the page when a field is focused; the keyboard hints
 * give a phone the email keyboard and a "Go" key.
 *
 * The form is in the server's HTML, so it can be submitted before React attaches `onSubmit`. The
 * browser would then submit it itself, and a form with no `method` is a GET: the email and the
 * password would land in the address bar, the history and every access log. So the button waits
 * for hydration, and `method="post"` keeps a secret out of a URL whatever happens.
 */
export function CredentialsForm({
  mode,
  destination,
}: {
  mode: AuthMode;
  destination: string;
}): React.ReactElement {
  const t = useTranslations("auth");
  const hydrated = useHydrated();

  return (
    <>
      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[var(--color-border)]" />
        </div>
        <div className="relative flex justify-center">
          <span className="mono-label bg-[var(--color-surface-solid)] px-3 lg:bg-[var(--color-background)]">
            {t("orWithEmail")}
          </span>
        </div>
      </div>

      <form
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          signIn("credentials", {
            email: formData.get("email"),
            password: formData.get("password"),
            callbackUrl: destination,
          });
        }}
        className="space-y-3"
      >
        <div>
          <label htmlFor="auth-email" className="mono-label-xs mb-1.5 block">
            {t("email")}
          </label>
          <input
            id="auth-email"
            name="email"
            type="email"
            inputMode="email"
            enterKeyHint="next"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            className={INPUT}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor="auth-password" className="mono-label-xs mb-1.5 block">
            {t("password")}
          </label>
          <input
            id="auth-password"
            name="password"
            type="password"
            enterKeyHint="go"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className={INPUT}
            placeholder="••••••••"
          />
        </div>
        <Button
          type="submit"
          disabled={!hydrated}
          className="h-12 w-full bg-[var(--color-primary)] font-semibold text-[var(--color-primary-foreground)] hover:opacity-90"
        >
          {mode === "signup" ? t("createAccount") : t("signIn")}
        </Button>
      </form>
    </>
  );
}
