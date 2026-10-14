import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { ErrorBoundary } from "@/components/shared/error-boundary";
import { LanguageSelector } from "@/components/shared/language-selector";
import { SitusPortalMark } from "@/components/shared/situs-portal-logo";
import { ThemeSwitcher } from "@/components/shared/theme-switcher";
import { ConsentLine } from "./consent-line";
import { CredentialsForm } from "./credentials-form";
import { GoogleButton } from "./google-button";
import { ProofLedger } from "./proof-ledger";

export type AuthMode = "signin" | "signup";

export interface AuthViewProps {
  mode: AuthMode;
  /** Whether the email and password form is shown (demo and self-hosted instances). */
  demoLoginEnabled: boolean;
  /** Whether a visitor with no account can create one (`isSignUpOpen`). */
  signUpOpen: boolean;
  /** Where to go after signing in: a same-site path, already checked on the server. */
  callbackUrl: string | null;
}

/**
 * What someone with no account is told. An instance that is open says how to create one; a closed
 * one (the default) says it is by invitation, instead of offering a link that ends in a refusal.
 */
function AccessLine({ mode, signUpOpen }: { mode: AuthMode; signUpOpen: boolean }) {
  const t = useTranslations("auth");
  const tMode = useTranslations(mode === "signin" ? "auth.signin" : "auth.signup");

  if (!signUpOpen) {
    return (
      <div className="mt-4 text-center">
        <p className="mono-label-xs">{t("accessByInvitation")}</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          {t("accessByInvitationNote")}
        </p>
      </div>
    );
  }

  return (
    <p className="mt-3 text-center text-sm text-[var(--color-muted-foreground)]">
      {tMode("switchText")}{" "}
      <Link
        href={mode === "signin" ? "/auth/signup" : "/auth/signin"}
        className="inline-flex items-center justify-center font-medium text-[var(--country-highlight-readable)] underline-offset-4 hover:underline max-md:min-h-11 max-md:min-w-11"
      >
        {tMode("switchAction")}
      </Link>
    </p>
  );
}

/**
 * The sign-in and sign-up page: a statement-style ledger of what Situs does above, the way in below.
 *
 * Phone: one column that fills the visible screen (`min-h-dvh`). The ledger sits under the mark; the
 * action area is anchored to the bottom, in reach of a thumb, with the safe-area inset under it.
 * Short screens drop the ledger instead of scrolling. Computer: two halves, ledger left and action
 * right. The same markup serves both: nothing is rendered twice.
 *
 * It is a server-rendered page. The visitor's session, whether sign-up is open and the callback
 * URL are resolved in `app/auth/render-auth.tsx`, so the form is in the first response (it used to
 * be a spinner until the session request came back).
 */
export function AuthView({ mode, demoLoginEnabled, signUpOpen, callbackUrl }: AuthViewProps) {
  const tBrand = useTranslations("auth.brand");
  const tMode = useTranslations(mode === "signin" ? "auth.signin" : "auth.signup");
  const destination = callbackUrl ?? "/dashboard";

  return (
    <ErrorBoundary>
      <main
        id="main-content"
        className="relative flex min-h-dvh flex-col bg-[var(--color-background)] lg:grid lg:grid-cols-2"
      >
        {/* Language and theme: the only way to change either before signing in, on every screen. */}
        <div className="absolute right-2 top-[max(0.25rem,env(safe-area-inset-top))] z-10 flex items-center lg:right-6 lg:top-6">
          <ThemeSwitcher />
          <LanguageSelector />
        </div>

        <section className="flex flex-1 flex-col px-5 pt-[max(0.75rem,env(safe-area-inset-top))] lg:justify-center lg:border-r lg:border-[var(--color-border)] lg:bg-[var(--color-surface-solid)] lg:px-12 lg:py-12">
          <div className="mx-auto w-full max-w-md">
            <div className="flex h-11 items-center gap-3">
              <SitusPortalMark className="h-8 w-8" />
              <span className="text-meta font-semibold uppercase tracking-[0.22em] text-[var(--color-foreground)]">
                Situs
              </span>
            </div>

            <div className="mt-6 lg:mt-14">
              <p className="mono-label mb-3">{tBrand("system")}</p>
              <p className="text-[clamp(26px,7vw,34px)] font-light leading-[1.12] tracking-[-0.03em] text-[var(--color-foreground)] lg:text-[clamp(28px,2.4vw,38px)]">
                {tBrand("tagline")}
              </p>
              <ProofLedger className="mt-6 lg:mt-10 [@media(max-height:700px)]:hidden" />
            </div>

            <div className="mt-10 hidden items-center gap-2 text-xs text-[var(--color-muted-foreground)] lg:flex">
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--country-highlight-readable)]" />
              <span>{tBrand("footer")}</span>
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-solid)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 lg:flex lg:items-center lg:justify-center lg:border-t-0 lg:bg-transparent lg:px-12 lg:py-12">
          <div className="mx-auto w-full max-w-sm motion-safe:animate-fade-in">
            <p className="mono-label mb-2">{tMode("eyebrow")}</p>
            <h1 className="text-[clamp(22px,6vw,28px)] font-normal leading-tight tracking-[-0.03em] text-[var(--color-foreground)]">
              {tMode("heading")}
            </h1>
            <p className="mt-2 hidden text-sm leading-relaxed text-[var(--color-muted-foreground)] lg:block [@media(min-height:800px)]:block">
              {tMode("subheading")}
            </p>

            <GoogleButton label={tMode("primary")} destination={destination} className="mt-5" />

            {demoLoginEnabled && <CredentialsForm mode={mode} destination={destination} />}

            <AccessLine mode={mode} signUpOpen={signUpOpen} />
            <ConsentLine className="mt-4" />
          </div>
        </section>
      </main>
    </ErrorBoundary>
  );
}

export default AuthView;
