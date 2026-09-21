"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";

import { TrackedLandingLink } from "@/components/shared/landing-analytics";
import { LanguageSelector } from "@/components/shared/language-selector";
import { SitusPortalMark } from "@/components/shared/situs-portal-logo";
import { Button } from "@/components/ui/button";

/**
 * App-native welcome screen for the installed PWA. Only ever renders for signed-out visitors
 * (mounted from the already signed-out-gated `app/[_locale]/page.tsx`) opening the app in
 * standalone display mode — a normal browser tab always sees the full marketing page instead.
 *
 * Sequence: the Portal mark forms alone, dead-centre of the whole screen — then the orbiting
 * rings/glow enter around it — then it all settles: the entire orbit (rings + mark, scaled as one
 * rigid unit so their proportions never change) explicitly travels from screen-centre up to a
 * fixed resting spot near the top, while the headline and three actions rise in below it. That
 * travel is an explicit `top`/`y` animation on one "identity block" (orbit + wordmark + tagline),
 * not an emergent side-effect of reflow — mirrors how the desktop hero's `.heroVisual` explicitly
 * translates+scales as one unit rather than leaving position to layout. Plays once per mount;
 * does not loop.
 */

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
// For the identity block's position/scale travel specifically — EASE_OUT above is an extremely
// front-loaded curve (both y-control-points sit at 1.0), great for a quick fade-in but wrong for a
// large, visible move: it reaches ~99% of the distance in the first ~10% of the duration, so the
// travel reads as an instant snap followed by an imperceptible settle, not a glide. This is the
// same symmetric ease already used below for the mark's own stroke draw-on (arcVariants) — evenly
// paced across the full duration.
const TRAVEL_EASE = [0.65, 0, 0.35, 1] as const;

type Phase = "mark" | "rings" | "welcome";

/** How long the rings/glow moment lingers before settling into welcome. */
const RINGS_HOLD_MS = 1400;

/** The orbit box's side length at rest (full scale) — see the `orbit` motion.div below for why
 *  290, not 236. Half of it is how far the identity block must shift up so the orbit itself (not
 *  the wordmark/tagline hanging below it) lands on the stage's true vertical centre. */
const REST_ORBIT_SIZE = 290;
const REST_ORBIT_HALF_HEIGHT = REST_ORBIT_SIZE / 2;

const wordContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 1.15 } },
};
const letterIn = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
};
const tagIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4, delay: 1.6 } },
};
const fxIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5 } },
  exit: { opacity: 0, transition: { duration: 0.4 } },
};
// Scales the WHOLE orbit box (rings + mark together) as one rigid unit — matching the desktop
// hero's `.heroVisual` transform — rather than scaling the mark alone inside static-size rings.
// That older approach left the mark-to-ring ratio inconsistent: fine at full scale, but once the
// mark alone shrank the rings stayed full-size around it, reading as a small mark adrift in
// oversized rings. Scaling the box keeps rings and mark in constant proportion at every size.
const orbitScale = {
  full: { scale: 1 },
  settled: { scale: 0.6, transition: { duration: 0.7, ease: TRAVEL_EASE } },
};
const belowContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};
const riseIn = {
  hidden: { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
};

export function PwaWelcome() {
  const [standalone, setStandalone] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(prefersReducedMotion ? "welcome" : "mark");
  const t = useTranslations("landing");

  useEffect(() => {
    const isStandaloneDisplay = window.matchMedia("(display-mode: standalone)").matches;
    const isIosStandalone =
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setStandalone(isStandaloneDisplay || isIosStandalone);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) setPhase("welcome");
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (phase !== "rings" || prefersReducedMotion) return;
    const timer = setTimeout(() => setPhase("welcome"), RINGS_HOLD_MS);
    return () => clearTimeout(timer);
  }, [phase, prefersReducedMotion]);

  if (!standalone) return null;

  // The rings stay up through the settled state rather than fading out with the entrance — they
  // are part of the welcome composition, not just a flourish, and the mark alone read as bare and
  // undersized against the copy below it. Their rotation is `motion-safe:` gated in the class
  // lists, so a reduced-motion visitor gets the same static composition instead of no rings at all.
  const showFx = phase !== "mark";
  const settled = phase === "welcome";

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-[var(--color-canvas)] px-6"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {settled && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="flex justify-end pt-5"
        >
          <LanguageSelector compact />
        </motion.div>
      )}

      {/* The "stage": a plain relative area, no centering of its own. Its only child is the
          identity block below, which positions itself explicitly — the stage just supplies the
          coordinate space (and, via the surrounding flex column, however much height is left once
          the language-pill row above and the CTA row below claim theirs). */}
      <div className="relative flex-1">
        {/* One rigid, explicitly positioned unit: orbit + wordmark + tagline (+ headline once
            settled). `top`/`y` are the ONLY position driver, rather than leaving position to
            emerge from flex-centering a group whose content keeps growing.
            Rest: top 50% + y REST_Y_OFFSET. REST_Y_OFFSET is a fixed px value (half the orbit's
            own rest-scale height, negative), NOT "-50%" — "-50%" would centre the whole block
            (orbit + wordmark + tagline stacked below it), landing the *orbit* above the true
            centre by roughly half the wordmark+tagline's height. The ask was for the mark itself
            to sit dead-centre of the screen, so the offset has to be anchored to the orbit alone.
            Settled: top 12% + y 0 — measured so the leftover space above and below the settled
            block (with the headline mounted, and the 290px rest orbit box) splits close to
            evenly, ~75px/70px at a 390x844 phone, rather than crowding the block against the
            language-pill row and leaving a lopsided gap before the CTAs (top:6% produced a
            37px/135px split; top:14% — tuned before the orbit box grew from 236 to 290px — had
            drifted to 87px/57px). */}
        <motion.div
          className="absolute left-1/2 flex flex-col items-center text-center"
          // Without an explicit `initial`, framer-motion treats the first `animate` values as an
          // entrance to transition INTO from an implicit zero baseline — the block would visibly
          // animate in from the top-left corner on mount instead of simply appearing already
          // centred. Pinning `initial` to whatever the very first render's target actually is
          // makes mount instant and reserves the transition for the one real move later: rest ->
          // settled. Reduced-motion visitors start with `phase` already at "welcome" (see useState
          // above), so their first render's target IS the settled position — using the rest
          // position here instead would make *that* the thing that animates, which is exactly the
          // motion prefers-reduced-motion asks to skip.
          initial={
            prefersReducedMotion
              ? { x: "-50%", top: "12%", y: 0 }
              : { x: "-50%", top: "50%", y: -REST_ORBIT_HALF_HEIGHT }
          }
          animate={{
            x: "-50%",
            top: settled ? "12%" : "50%",
            y: settled ? 0 : -REST_ORBIT_HALF_HEIGHT,
          }}
          transition={{ duration: 0.7, ease: TRAVEL_EASE }}
        >
          <motion.div
            animate={settled ? "settled" : "full"}
            variants={orbitScale}
            className="relative grid place-items-center"
            // 290, not 236: 236 only just cleared the mark's own dashed keyline (~172px visible
            // disk) from the inner ring (192px at a 22px inset) — ~10px of clearance each side,
            // which read as cramped rather than as breathing room. 290 (with the inner ring's
            // inset widened to 30px below) roughly triples that to ~29px each side, closer to how
            // generously the desktop hero's own rings clear its mark. Scaling the whole box as one
            // unit (see orbitScale) keeps that clearance proportionally constant at every size.
            style={{ width: REST_ORBIT_SIZE, height: REST_ORBIT_SIZE }}
          >
            <AnimatePresence>
              {showFx && (
                <motion.div
                  className="absolute inset-0"
                  variants={fxIn}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 -z-10 rounded-full blur-xl motion-safe:animate-[pulse-gentle_3.4s_ease-in-out_infinite]"
                    style={{
                      background:
                        "radial-gradient(circle, color-mix(in srgb, var(--logo-primary) 28%, transparent) 0%, transparent 72%)",
                    }}
                  />
                  {/* Keyline halo on the border, same trick the mark's own strokes use: some
                      countries' primary colour sits close to the canvas (e.g. Germany's black in
                      dark mode), so the flag colour alone isn't a reliable contrast guarantee. */}
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full border border-dashed border-[color-mix(in_srgb,var(--logo-primary)_55%,var(--color-border))] opacity-70 shadow-[0_0_0_1px_var(--logo-keyline)] motion-safe:animate-[spin_24s_linear_infinite]"
                  >
                    <span
                      aria-hidden
                      className="absolute left-1/2 top-0 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        background: "var(--logo-primary)",
                        boxShadow:
                          "0 0 0 1px var(--logo-keyline), 0 0 9px 2px color-mix(in srgb, var(--logo-primary) 75%, transparent), 0 0 2px 1px var(--logo-primary)",
                      }}
                    />
                  </span>
                  <span
                    aria-hidden
                    className="absolute inset-[30px] rounded-full border border-dashed border-[color-mix(in_srgb,var(--logo-secondary)_45%,var(--color-border))] opacity-70 shadow-[0_0_0_1px_var(--logo-keyline)] motion-safe:animate-[spin_17s_linear_infinite_reverse]"
                  >
                    <span
                      aria-hidden
                      className="absolute bottom-0 left-1/2 h-[6px] w-[6px] -translate-x-1/2 translate-y-1/2 rounded-full"
                      style={{
                        background: "var(--logo-secondary)",
                        boxShadow:
                          "0 0 0 1px var(--logo-keyline), 0 0 9px 2px color-mix(in srgb, var(--logo-secondary) 75%, transparent), 0 0 2px 1px var(--logo-secondary)",
                      }}
                    />
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            <span className="relative z-10">
              <SitusPortalMark
                size="hero"
                animated={!prefersReducedMotion}
                onDrawComplete={() => setPhase((p) => (p === "mark" ? "rings" : p))}
              />
            </span>
          </motion.div>

          <motion.div
            variants={wordContainer}
            initial={prefersReducedMotion ? "visible" : "hidden"}
            animate="visible"
            className="mt-8 flex text-xl font-bold uppercase tracking-[0.34em]"
          >
            {"SITUS".split("").map((char, i) => (
              <motion.span key={i} variants={letterIn}>
                {char}
              </motion.span>
            ))}
          </motion.div>

          <motion.p
            variants={tagIn}
            initial={prefersReducedMotion ? "visible" : "hidden"}
            animate="visible"
            className="mono-label mt-2"
          >
            Sovereign Capital System
          </motion.p>

          {settled && (
            <motion.div
              variants={belowContainer}
              initial="hidden"
              animate="visible"
              className="mt-7 max-w-[27ch]"
            >
              <motion.div
                variants={riseIn}
                className="mx-auto mb-6 h-px w-8 bg-[var(--color-border)]"
              />
              <motion.h2
                variants={riseIn}
                className="text-[19px] font-normal leading-snug tracking-[-0.02em]"
              >
                {t("hero2")}
              </motion.h2>
            </motion.div>
          )}
        </motion.div>
      </div>

      {settled && (
        <motion.div
          variants={belowContainer}
          initial="hidden"
          animate="visible"
          className="flex flex-col gap-2.5 pb-6"
        >
          <motion.div variants={riseIn} whileTap={{ scale: 0.97 }}>
            <TrackedLandingLink
              href="/auth/signup"
              eventName="landing.signup_start"
              eventData={{ location: "pwa_welcome" }}
            >
              <Button size="lg" className="w-full rounded-none font-semibold">
                {t("heroCta.join")}
              </Button>
            </TrackedLandingLink>
          </motion.div>
          <motion.div variants={riseIn} whileTap={{ scale: 0.97 }}>
            <TrackedLandingLink
              href="/auth/signin"
              eventName="landing.signin_start"
              eventData={{ location: "pwa_welcome" }}
            >
              <Button size="lg" variant="outline" className="w-full rounded-none font-semibold">
                {t("signIn")}
              </Button>
            </TrackedLandingLink>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
