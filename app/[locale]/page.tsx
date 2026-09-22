import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LandingAnalyticsObserver } from "@/components/shared/landing-analytics";
import { LandingHeroSequence } from "@/components/shared/landing-hero-sequence";
import { LocaleSelectOverlay } from "@/components/shared/locale-select-overlay";
import { PwaWelcome } from "@/components/shared/pwa-welcome";

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function LandingPage({ params }: Props) {
  const { locale } = await params;

  // Authenticated visitors go straight to the app.
  try {
    const { getServerSession } = await import("next-auth/next");
    const { getAuthOptions } = await import("@/lib/services/auth/auth");
    const session = await getServerSession(getAuthOptions());
    if (session?.user) {
      redirect("/dashboard");
    }
  } catch {
    // Session check failed — render the public landing normally.
  }

  const tFooter = await getTranslations("footer");

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-foreground)]">
      <LocaleSelectOverlay currentLocale={locale} />

      {/* Installed-PWA visitors get an app-native welcome instead of the marketing scroll below.
          Renders null for normal browser tabs (standalone display-mode detected client-side). */}
      <PwaWelcome />

      {/* The whole page is this one screen — no header/nav, no marketing sections below it, on
          any viewport. LandingHeroSequence carries its own locale control and CTAs, so nothing
          else needs to be mounted around it. Desktop centers the hero vertically in the
          viewport (lg:flex + justify-center); mobile leaves height to LandingHeroSequence's own
          full-height column, which already pins its CTAs to the bottom. */}
      {/* Asymmetric mobile padding (pt-8/pb-16, not py-16): the language-selector chip sits right
          at the top of the hero column, so it inherits this top offset directly — py-16 put it
          64px down for no reason beyond reusing the desktop value. lg: keeps the original
          symmetric spacing used for desktop centering. */}
      {/* Content container: without a max-width the hero ran edge-to-edge, leaving the headline
          ~40px from the left of a wide desktop with dead space opposite. --page-max is read by
          landing-hero-sequence.module.css so the fixed locale control lines up with this same
          column instead of the viewport corner. */}
      <main
        style={{ "--page-max": "1400px" } as React.CSSProperties}
        className="relative mx-auto w-full max-w-[var(--page-max)] px-5 pt-8 pb-16 sm:px-10 lg:flex lg:min-h-screen lg:flex-col lg:justify-center lg:py-24"
      >
        <LandingAnalyticsObserver locale={locale} />

        <LandingHeroSequence locale={locale} />

        {/* Condensed on the smallest screens — the full localized sentence plus both links was
            wrapping to two dense uppercase lines and reading heavy against the CTA stack right
            above it. Below sm: brand + year only (safe to hand-construct, no locale string
            surgery) before the always-present, always-localized Privacy/Terms links.

            border-t here is deliberate: with nothing tying it to the content above, this line
            read as an appendix bolted onto the bottom of the page rather than part of the
            composition — the divider (same border language used throughout the app) turns the
            empty space above it into a legible footer band instead of a gap. */}
        <p className="mono-label-xs absolute inset-x-0 bottom-4 border-t border-[var(--color-border)] px-5 pt-4 pb-[env(safe-area-inset-bottom)] text-center text-[var(--color-muted-foreground)] lg:bottom-6 lg:pb-0">
          <span className="sm:hidden">© {new Date().getFullYear()} Situs</span>
          <span className="hidden sm:inline">
            {tFooter("copyright", { year: new Date().getFullYear() })}
          </span>{" "}
          ·{" "}
          <a href={"/privacy"} className="transition-colors hover:text-[var(--color-foreground)]">
            {tFooter("privacy")}
          </a>{" "}
          ·{" "}
          <a href={"/terms"} className="transition-colors hover:text-[var(--color-foreground)]">
            {tFooter("terms")}
          </a>
        </p>
      </main>
    </div>
  );
}
