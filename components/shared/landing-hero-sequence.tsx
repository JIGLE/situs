"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "framer-motion";
import { ArrowDown, ChevronDown } from "lucide-react";

import { SitusPortalMark } from "@/components/shared/situs-portal-logo";
import { TrackedLandingLink } from "@/components/shared/landing-analytics";
import { LanguageSelector } from "@/components/shared/language-selector";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/contexts/theme-context";
import type { CountryCode } from "@/lib/design/country-themes";
import { locales, localeNames, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils/utils";

import styles from "./landing-hero-sequence.module.css";

/**
 * Desktop landing hero — scroll-scrubbed splash-to-settle sequence.
 *
 * At rest the mark sits centred on the whole hero at 1.3x scale with the rings already
 * spinning; scrolling the wheel travels it into its settled two-column position over the first
 * half of the gesture, then reveals the headline, subtitle and three actions over the second
 * half. Desktop only (lg:+) — mobile keeps the plain static hero below, and the installed-PWA
 * welcome screen (components/shared/pwa-welcome.tsx) already covers the equivalent mobile
 * moment.
 */

const LOCALE_FLAGS: Record<Locale, string> = { pt: "🇵🇹", en: "🇬🇧", es: "🇪🇸", it: "🇮🇹" };

const COMING_SOON_LOCALES: { code: string; flag: string; label: string }[] = [
  { code: "fr", flag: "🇫🇷", label: "Français" },
  { code: "de", flag: "🇩🇪", label: "Deutsch" },
];

// The countries Situs operates in. lib/design/country-themes.ts holds a theme per entry here;
// adding a country means adding it to both.
const COUNTRY_SWATCH: { code: CountryCode; hex: string }[] = [
  { code: "PT", hex: "#006600" },
  { code: "ES", hex: "#aa151b" },
];

interface Props {
  locale: string;
}

export function LandingHeroSequence({ locale }: Props): React.ReactElement {
  const t = useTranslations("landing");
  const tLocaleCtrl = useTranslations("landing.localeControl");
  const tCountries = useTranslations("landing.countries");
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const { country, setCountry } = useTheme();

  const rootRef = useRef<HTMLDivElement>(null);
  const r1Ref = useRef<HTMLSpanElement>(null);
  const r2Ref = useRef<HTMLSpanElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<HTMLButtonElement>(null);
  const ctaRefs = useRef<Array<HTMLDivElement | null>>([]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const root = rootRef.current;
    const orbitEl = orbitRef.current;
    const jumpEl = jumpRef.current;
    if (!root) return;

    if (!window.matchMedia("(min-width: 1024px)").matches) {
      // Mobile has no scroll sequence — the visual is hidden entirely (see JSX) — so the copy
      // must render settled, not stuck at the splash's --p: 0. The CSS module also forces this
      // below the lg breakpoint on its own (belt-and-suspenders against any pre-hydration gap);
      // this just keeps the two in sync explicitly.
      root.style.setProperty("--p", "1");
      return;
    }

    if (reducedMotion) {
      root.style.setProperty("--p", "1");
      return;
    }

    let target = 0;
    let current = 0;
    let last: number | null = null;
    let angle1 = 0;
    let angle2 = 0;
    let boost = 1;
    let snapTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId = 0;

    const BASE1 = 360 / 26; // deg/s at resting speed
    const BASE2 = -360 / 19; // deg/s at resting speed, reverse
    const MAX_BOOST = 3.2; // how much faster the rings spin while actively scrolling
    const BOOST_DECAY = 2.4; // per second — how fast that boost eases back to 1x once idle
    const EASE_RATE = 5.5; // time-based easing rate, frame-rate independent
    const SNAP_DELAY = 400; // ms idle before the magnet can act
    const SNAP_HIGH = 0.85; // only auto-complete forward once genuinely close to the end
    const SNAP_LOW = 0.15; // only auto-complete backward once genuinely close to the splash

    function tick(now: number) {
      if (last === null) last = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Time-based exponential easing: smooth regardless of the display's refresh rate.
      const ease = 1 - Math.exp(-EASE_RATE * dt);
      current += (target - current) * ease;
      if (Math.abs(target - current) < 0.0004) current = target;
      root!.style.setProperty("--p", current.toFixed(4));

      if (r1Ref.current && r2Ref.current) {
        boost += (1 - boost) * Math.min(1, BOOST_DECAY * dt);
        angle1 = (angle1 + BASE1 * boost * dt) % 360;
        angle2 = (angle2 + BASE2 * boost * dt) % 360;
        r1Ref.current.style.rotate = `${angle1.toFixed(2)}deg`;
        r2Ref.current.style.rotate = `${angle2.toFixed(2)}deg`;
      }

      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    function onWheel(e: WheelEvent) {
      // Once the page has scrolled past the hero, behave like a normal section.
      if (window.scrollY > 0) return;
      const atStart = target <= 0 && e.deltaY < 0;
      const atEnd = target >= 1 && e.deltaY > 0;
      if (atStart || atEnd) return;
      e.preventDefault();
      target = Math.max(0, Math.min(1, target + e.deltaY * 0.0015));
      boost = MAX_BOOST;

      // Scroll magnet: only engage close to either end, and only after a real pause — a slow,
      // deliberate scroll through the middle is never fought.
      if (snapTimer) clearTimeout(snapTimer);
      snapTimer = setTimeout(() => {
        if (target > SNAP_HIGH) target = 1;
        else if (target < SNAP_LOW) target = 0;
      }, SNAP_DELAY);
    }
    root.addEventListener("wheel", onWheel, { passive: false });

    function onMouseMove(e: MouseEvent) {
      const rect = root!.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width - 0.5;
      const my = (e.clientY - rect.top) / rect.height - 0.5;
      root!.style.setProperty("--mx", `${(mx * 20).toFixed(1)}px`);
      root!.style.setProperty("--my", `${(my * 20).toFixed(1)}px`);
    }
    root.addEventListener("mousemove", onMouseMove);

    function onJump() {
      if (snapTimer) clearTimeout(snapTimer);
      target = 1;
    }
    jumpEl?.addEventListener("click", onJump);

    function bloom() {
      if (!orbitEl) return;
      orbitEl.classList.remove(styles.orbitBlooming);
      void orbitEl.offsetWidth; // force reflow so the animation can retrigger on repeat clicks
      orbitEl.classList.add(styles.orbitBlooming);
    }
    function onOrbitKeydown(e: KeyboardEvent) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        // Keyboard must do what the click does, or the mark is a control with two meanings.
        onJump();
      }
    }
    function onOrbitAnimEnd(e: AnimationEvent) {
      if (e.animationName === "dilate") orbitEl?.classList.remove(styles.orbitBlooming);
    }
    // Clicking the mark skips to the end of the sequence — the obvious reading of "click the
    // logo". The colour bloom it used to trigger moves to hover, where it survives as ambient
    // polish without competing for the click.
    orbitEl?.addEventListener("click", onJump);
    orbitEl?.addEventListener("mouseenter", bloom);
    orbitEl?.addEventListener("keydown", onOrbitKeydown);
    orbitEl?.addEventListener("animationend", onOrbitAnimEnd);

    const ctaCleanups: Array<() => void> = [];
    for (const el of ctaRefs.current) {
      if (!el) continue;
      const pulse = () => {
        el.classList.remove(styles.isPulsing);
        void el.offsetWidth;
        el.classList.add(styles.isPulsing);
      };
      const onAnimEnd = (e: AnimationEvent) => {
        if (e.animationName === "ctaPulse") el.classList.remove(styles.isPulsing);
      };
      el.addEventListener("click", pulse);
      el.addEventListener("animationend", onAnimEnd);
      ctaCleanups.push(() => {
        el.removeEventListener("click", pulse);
        el.removeEventListener("animationend", onAnimEnd);
      });
    }

    return () => {
      cancelAnimationFrame(rafId);
      if (snapTimer) clearTimeout(snapTimer);
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("mousemove", onMouseMove);
      jumpEl?.removeEventListener("click", onJump);
      orbitEl?.removeEventListener("click", onJump);
      orbitEl?.removeEventListener("mouseenter", bloom);
      orbitEl?.removeEventListener("keydown", onOrbitKeydown);
      orbitEl?.removeEventListener("animationend", onOrbitAnimEnd);
      ctaCleanups.forEach((fn) => fn());
    };
  }, [reducedMotion]);

  function switchLocale(newLocale: Locale) {
    if (newLocale === locale) return;
    document.cookie = `situs-locale=${newLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    // URLs carry no locale segment, so there is nothing to swap. Overwriting segments[1] used to
    // work by accident on `/` and sent `/privacy` to the landing page everywhere else; the server
    // layout reads the cookie set above, so a refresh is the whole switch.
    router.refresh();
    setMenuOpen(false);
  }

  function selectCountry(code: CountryCode) {
    setCountry(code);
    setMenuOpen(false);
  }

  const filterQuery = filter.trim().toLowerCase();
  const filteredCountries = COUNTRY_SWATCH.filter(({ code }) => {
    if (!filterQuery) return true;
    return (
      code.toLowerCase().includes(filterQuery) ||
      tCountries(code.toLowerCase()).toLowerCase().includes(filterQuery)
    );
  });

  return (
    <div
      ref={rootRef}
      className={cn(styles.root, "grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]")}
    >
      {/* Locale control — language + country theme, top-right, desktop only */}
      <div className={cn(styles.localeControl, "hidden lg:block")}>
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-canvas)] px-2.5 py-1.5 font-mono text-[12px] md:text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]"
        >
          {/* No flag emoji here: Windows ships no country-flag glyphs, so `🇵🇹` falls back to
              the regional-indicator letters and the trigger reads "PT PT". The code alone is
              unambiguous; the menu below still pairs flags with full language names. */}
          {locale.toUpperCase()}
          <ChevronDown className="h-2.5 w-2.5 opacity-70" aria-hidden />
        </button>

        {menuOpen && (
          <div className={styles.localeMenu} onMouseLeave={() => setMenuOpen(false)}>
            <div className={styles.localeGroup}>
              <p className="mono-label mb-2">{tLocaleCtrl("language")}</p>
              <div className={styles.localeOptions}>
                {locales.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => switchLocale(l)}
                    className={cn(styles.localeOpt, l === locale && styles.localeOptActive)}
                  >
                    {LOCALE_FLAGS[l]}&nbsp; {localeNames[l]}
                  </button>
                ))}
                {COMING_SOON_LOCALES.map((entry) => (
                  <span
                    key={entry.code}
                    className={cn(styles.localeOpt, styles.localeOptSoon)}
                    aria-disabled
                  >
                    {entry.flag}&nbsp; {entry.label}
                    <span className={styles.soonTag}>{tLocaleCtrl("comingSoon")}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.localeGroup}>
              <p className="mono-label mb-2">{tLocaleCtrl("countryTheme")}</p>
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={tLocaleCtrl("searchCountry")}
                className={styles.localeFilter}
              />
              <div className={styles.countryGrid}>
                {filteredCountries.map(({ code, hex }) => (
                  <button
                    key={code}
                    type="button"
                    title={tCountries(code.toLowerCase())}
                    style={{ background: hex }}
                    onClick={() => selectCountry(code)}
                    className={cn(styles.countryChip, country === code && styles.countryChipActive)}
                  >
                    {code}
                  </button>
                ))}
              </div>
              {filteredCountries.length === 0 && (
                <p className="mt-1.5 text-[11.5px] text-[var(--color-muted-foreground)]">
                  {tLocaleCtrl("noMatch")}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile-only locale switch — fixed to the viewport corner (not part of the hero-copy
          flex column below), so it stays put regardless of that column's own centering, and
          matches the desktop locale control's now-fixed positioning above. The animated popover
          above is desktop-only, so without this a phone visitor who lands on the wrong locale
          (past the first-visit overlay) has no way to change it. */}
      <div className="fixed right-5 top-[max(20px,env(safe-area-inset-top))] z-20 lg:hidden">
        <LanguageSelector
          compact
          className="border border-[var(--color-border)] bg-[var(--color-canvas)]"
        />
      </div>

      {/* Hero copy */}
      {/* min-h subtracts the parent <main>'s own mobile padding (pt-8 + pb-16 = 2rem + 4rem =
          6rem) — without that this column's forced full-viewport height stacks on top of main's
          padding instead of sharing it, overflowing the real viewport and pushing the last CTA +
          footer below the fold on an actual phone. justify-center (not justify-start): centering
          the whole block as one group reads calmer than pinning it to the top, which put the CTAs
          right under the headline with nothing below, or to the bottom via mt-auto, which left a
          191px dead zone above them — center once, let both margins breathe evenly instead. */}
      <div className="flex min-h-[calc(100svh-6rem)] flex-col justify-center pb-[env(safe-area-inset-bottom)] lg:block lg:min-h-0 lg:justify-start lg:pb-0">
        {/* Mobile-only orbit — brings the same rings/mark motion the desktop hero and the
            installed-PWA welcome screen use into the phone view, instead of the old plain static
            mark. Gentle continuous CSS spin; see the module's reduced-motion block for the
            static fallback. Sized up from the first pass (h-16 mark in a 168px orbit) — it read
            as small for the amount of screen it's the focal point of. */}
        <div className={styles.mobileOrbit}>
          <span className={styles.mobileGlow} aria-hidden />
          <span className={cn(styles.mobileRing, styles.mobileRingR1)} aria-hidden />
          <span className={cn(styles.mobileRing, styles.mobileRingR2)} aria-hidden />
          <SitusPortalMark className="relative z-[1] h-20 w-20" />
        </div>

        <p className={cn("mono-label mb-5", styles.copyEyebrow)}>{t("eyebrow")}</p>
        {/* Mobile gets its own, lower clamp floor: at 7vw the old clamp(44px,7vw,88px) hit its
            44px floor on every phone width (7vw ≈ 27px at 390px, well under it), a hard jump from
            the 10px eyebrow with nothing in between. lg: restores the original curve untouched. */}
        <h1
          className={cn(
            "max-w-2xl text-[clamp(32px,9vw,88px)] font-normal leading-[0.9] tracking-[-0.06em] lg:text-[clamp(44px,7vw,88px)]",
            styles.copyH1,
          )}
        >
          {t("hero2")}
        </h1>
        {/* The descriptive subtitle is dropped on mobile — the headline + CTAs carry the screen
            there; kept for desktop where there's room to earn it. */}
        <p
          className={cn(
            "mt-7 hidden max-w-xl text-[clamp(16px,1.5vw,19px)] leading-relaxed text-[var(--color-muted-foreground)] lg:block",
            styles.copySubtitle,
          )}
        >
          {t("subtitle2")}
        </p>

        {/* Fixed margin, not mt-auto — pinning this row to the bottom of a full-height mobile
            column left a ~191px dead zone between the headline and the buttons. Any leftover
            space now falls below the row instead, near the footer. */}
        <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:mt-8">
          <div
            ref={(el) => {
              ctaRefs.current[0] = el;
            }}
            className={cn(styles.ctaWrap1, styles.ctaPulse, "w-full sm:w-auto")}
          >
            <TrackedLandingLink
              href="/auth/signup"
              eventName="landing.signup_start"
              eventData={{ location: "hero_secondary" }}
              className="block w-full sm:w-auto"
            >
              <Button size="lg" className="w-full rounded-none font-semibold sm:w-auto">
                {t("heroCta.join")}
              </Button>
            </TrackedLandingLink>
          </div>
          <div
            ref={(el) => {
              ctaRefs.current[1] = el;
            }}
            className={cn(styles.ctaWrap2, styles.ctaPulse, "w-full sm:w-auto")}
          >
            <TrackedLandingLink
              href="/auth/signin"
              eventName="landing.signin_click"
              eventData={{ location: "hero" }}
              className="block w-full sm:w-auto"
            >
              {/* Tertiary, back in the row as a real button — a plain-text link read as too
                  disconnected from "Experimentar"/"Aderir" to feel like part of the same group.
                  variant="ghost" alone was near-invisible (no border), so it's paired with an
                  explicit thin border here: quieter than "Aderir"'s filled-outline box, but still
                  a legible button rather than bare text. */}
              <Button
                size="lg"
                variant="ghost"
                className="w-full rounded-none border border-[var(--color-border)] font-semibold sm:w-auto"
              >
                {t("signIn")}
              </Button>
            </TrackedLandingLink>
          </div>
        </div>
      </div>

      {/* Empty grid track — just reserves the right column's width/height so the full-bleed
          overlay below (a root-level sibling, not nested in here) lands exactly where this
          column would have put it once --v resolves. */}
      <div className="hidden min-h-[520px] lg:block" />

      {/* Hero visual — full-bleed overlay directly on .root (not the column above), so its own
          width spans the whole two-column grid: centred on the whole hero at rest, then the CSS
          module's percentage-based translate carries it into the right column's space as --v
          resolves. Must be a direct child of .root (the nearest `position: relative` ancestor)
          for that percentage math to resolve against the right width. */}
      <div className={styles.heroVisual}>
        <div
          ref={orbitRef}
          role="button"
          tabIndex={0}
          aria-label={tLocaleCtrl("jumpAria")}
          className={styles.orbit}
        >
          <span className={styles.glow} aria-hidden />
          <span ref={r1Ref} className={cn(styles.ring, styles.ringR1)} aria-hidden />
          <span ref={r2Ref} className={cn(styles.ring, styles.ringR2)} aria-hidden />
          <span className={styles.markScale}>
            {/* Grows with the orbit's clamped size so the mark-to-ring proportion holds. */}
            <SitusPortalMark size="sm" className="h-36 w-36 lg:h-44 lg:w-44" />
          </span>
        </div>
        <div className={styles.splashFooter}>
          <p className={cn("mono-label", styles.wordmark)}>Situs</p>
          <button
            ref={jumpRef}
            type="button"
            className={styles.scrollHint}
            aria-label={tLocaleCtrl("jumpAria")}
          >
            <ArrowDown aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
