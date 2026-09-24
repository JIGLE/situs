"use client";

import { Suspense, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/shared/language-selector";
import { SitusPortalMark } from "@/components/shared/situs-portal-logo";

/** Only allow same-site relative paths, to rule out an open redirect via `callbackUrl`. */
function safeCallbackUrl(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export type AuthMode = "signin" | "signup";

/** The three proof points shown on the brand panel — the owner workflow in one line each. */
const PROOF_KEYS = [
  { k: "01", label: "bankLabel", note: "bankNote" },
  { k: "02", label: "receiptLabel", note: "receiptNote" },
  { k: "03", label: "auditLabel", note: "auditNote" },
] as const;

/** Left brand panel: Portal mark orbited by dashed rings. */
function BrandPanel() {
  const t = useTranslations("auth.brand");

  return (
    <div className="relative hidden overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-surface-solid)] lg:flex lg:flex-col lg:items-center lg:justify-center lg:p-12">
      {/* Orbiting Portal motif */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          aria-hidden
          className="absolute aspect-square w-[26rem] rounded-full border border-dashed border-[color-mix(in_srgb,var(--logo-primary)_40%,var(--color-border))] opacity-60 motion-safe:animate-[spin_32s_linear_infinite]"
        />
        <div
          aria-hidden
          className="absolute aspect-square w-[19rem] rounded-full border border-dashed border-[color-mix(in_srgb,var(--logo-secondary)_40%,var(--color-border))] opacity-60 motion-safe:animate-[spin_24s_linear_infinite_reverse]"
        />
      </div>

      {/* Logo and legal line are chrome: pinned to the panel's corners so they cannot stretch
          the layout. Previously all three blocks were spaced by `justify-between`, which left a
          ~310px void under the logo and pushed the brand copy down to 40% of the viewport while
          the form opposite began at 23% — the two halves never read as one composition. */}
      <div className="absolute left-12 top-12 flex items-center gap-3">
        <SitusPortalMark className="h-9 w-9" />
        <span className="text-[13px] font-semibold uppercase tracking-[0.22em] text-[var(--color-foreground)]">
          Situs
        </span>
      </div>

      <div className="relative max-w-md motion-safe:animate-slide-up">
        <p className="mono-label mb-4">{t("system")}</p>
        <p className="text-[clamp(22px,2vw,30px)] font-normal leading-tight tracking-[-0.03em] text-[var(--color-foreground)]">
          {t("tagline")}
        </p>
        <div className="mt-9 space-y-4">
          {PROOF_KEYS.map((p) => (
            <div key={p.k} className="flex items-start gap-3">
              <span className="mono-label-xs pt-1 tabular-nums text-[var(--country-highlight-readable)]">
                {p.k}
              </span>
              <div>
                <p className="text-sm font-medium text-[var(--color-foreground)]">
                  {t(`proof.${p.label}`)}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {t(`proof.${p.note}`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-12 left-12 flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
        <ShieldCheck className="h-3.5 w-3.5 text-[var(--country-highlight-readable)]" />
        <span>{t("footer")}</span>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AuthContent({ mode, demoLoginEnabled }: { mode: AuthMode; demoLoginEnabled: boolean }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"));
  const t = useTranslations("auth");
  const tMode = useTranslations(mode === "signin" ? "auth.signin" : "auth.signup");

  // Resolved by the auth layout from the `situs-locale` cookie, so the language selector on
  // this page also decides which locale the viewer lands in after signing in. The previous
  // `detectLocale()` sniffed the referrer and `navigator.language` against a hardcoded
  // ["pt","en","es"] list that omitted Italian, stranding `it` users on `/pt/dashboard`.
  const destination = callbackUrl ?? "/dashboard";

  useEffect(() => {
    if (status === "authenticated") {
      router.push(destination);
    }
  }, [status, router, destination]);

  const continueWithGoogle = () => {
    signIn("google", { callbackUrl: destination });
  };

  if (status === "loading" || session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
        <div className="flex items-center gap-3 text-[var(--color-muted-foreground)]">
          <SitusPortalMark className="h-6 w-6 motion-safe:animate-pulse" />
          <span className="text-sm">{t("loading")}</span>
        </div>
      </div>
    );
  }

  return (
    // Equal halves. The old 0.9fr/1.1fr split gave the *wider* track to the form, which is a
    // fixed ~384px card, stranding it in 336px of dead space either side at 1920px. Weighting
    // the brand side instead just moved the void there. Both halves now centre a bounded
    // content block, so the two read as a pair across the divider at any width.
    <div className="grid min-h-screen bg-[var(--color-background)] lg:grid-cols-2">
      <BrandPanel />

      <div className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm motion-safe:animate-fade-in">
          {/* Brand lockup + locale control. The mark is desktop-hidden (BrandPanel carries it
              there), but the selector stays on every viewport: these pages sit outside the
              `[locale]` segment, so this is the only way to change language before signing in. */}
          <div className="mb-8 flex items-center justify-between gap-3 lg:justify-end">
            {/* `lg:hidden`, not `lg:invisible`: BrandPanel already carries the mark at lg, and
                leaving an invisible placeholder here left the locale control stranded on its
                own in a half-empty row. */}
            <div className="flex items-center gap-3 lg:hidden">
              <SitusPortalMark className="h-10 w-10" />
              <span className="text-[13px] font-semibold uppercase tracking-[0.22em]">Situs</span>
            </div>
            <LanguageSelector />
          </div>

          <p className="mono-label mb-3">{tMode("eyebrow")}</p>
          <h1 className="text-[clamp(26px,4vw,34px)] font-normal leading-tight tracking-[-0.03em] text-[var(--color-foreground)]">
            {tMode("heading")}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            {tMode("subheading")}
          </p>

          {/* Primary: Google (creates the account on first sign-in) */}
          <Button
            onClick={continueWithGoogle}
            variant="outline"
            className="mt-8 flex h-12 w-full items-center justify-center gap-3 border-[var(--color-border-hover)] text-[15px] font-medium"
          >
            <GoogleGlyph />
            {tMode("primary")}
          </Button>

          {/* Credentials — self-hosted / demo instances only */}
          {demoLoginEnabled && (
            <>
              <div className="relative my-7">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[var(--color-border)]" />
                </div>
                <div className="relative flex justify-center">
                  <span className="mono-label bg-[var(--color-background)] px-3">
                    {t("orWithEmail")}
                  </span>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
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
                    autoComplete="email"
                    className="w-full border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm text-[var(--color-foreground)] outline-none transition-colors placeholder:text-[var(--color-muted-foreground)] focus:border-[var(--country-highlight-readable)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
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
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    className="w-full border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm text-[var(--color-foreground)] outline-none transition-colors placeholder:text-[var(--color-muted-foreground)] focus:border-[var(--country-highlight-readable)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                    placeholder="••••••••"
                  />
                </div>
                <Button
                  type="submit"
                  className="h-11 w-full bg-[var(--color-primary)] font-semibold text-[var(--color-primary-foreground)] hover:opacity-90"
                >
                  {mode === "signup" ? t("createAccount") : t("signIn")}
                </Button>
              </form>
            </>
          )}

          {/* Mode switch */}
          <p className="mt-8 text-center text-sm text-[var(--color-muted-foreground)]">
            {tMode("switchText")}{" "}
            <button
              type="button"
              onClick={() => router.push(mode === "signin" ? "/auth/signup" : "/auth/signin")}
              className="inline-flex items-center justify-center font-medium text-[var(--country-highlight-readable)] underline-offset-4 hover:underline max-md:min-h-11 max-md:min-w-11"
            >
              {tMode("switchAction")}
            </button>
          </p>

          {demoLoginEnabled && process.env.NODE_ENV !== "production" && (
            <p className="mt-4 text-center text-xs text-[var(--color-muted-foreground)]">
              {t("demoModeHint")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Shared auth experience, rendered by both /auth/signin and /auth/signup.
 *
 * `demoLoginEnabled` is resolved on the server by `isDemoLoginEnabled()` and passed in, rather
 * than read from a NEXT_PUBLIC_* variable here. Two independent flags could disagree, and the
 * disagreement that mattered left a live admin login path with no visible form.
 */
export function AuthView({
  mode,
  demoLoginEnabled,
}: {
  mode: AuthMode;
  demoLoginEnabled: boolean;
}) {
  const t = useTranslations("auth");

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
            <div className="flex items-center gap-3 text-[var(--color-muted-foreground)]">
              <SitusPortalMark className="h-6 w-6" />
              <span className="text-sm">{t("loading")}</span>
            </div>
          </div>
        }
      >
        <AuthContent mode={mode} demoLoginEnabled={demoLoginEnabled} />
      </Suspense>
    </ErrorBoundary>
  );
}

export default AuthView;
