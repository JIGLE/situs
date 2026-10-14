import * as React from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils/utils";

/**
 * The Situs Portal — the single production logomark.
 *
 * A Bauhaus-inspired geometric gateway: dotted perimeter (system boundary),
 * semi-circular arc (access and perimeter), foundation line (ledger grounding)
 * and central dot (decision focus). Colours come exclusively from the
 * `--logo-*` CSS variables, so the mark re-themes itself when the country
 * palette changes — authentic flag colours mapped by role, never tinted.
 * Visibility on any surface is guaranteed by the keyline + logo canvas,
 * not by altering the flag colours.
 *
 * Hook-free so it renders in both Server and Client Components.
 */

const SIZE_CLASSES = {
  sm: "h-7 w-7",
  md: "h-16 w-16",
  lg: "h-[132px] w-[132px]",
  hero: "h-[190px] w-[190px]",
} as const;

export type PortalLogoSize = keyof typeof SIZE_CLASSES;

const arcVariants = {
  hidden: { pathLength: 0 },
  visible: { pathLength: 1, transition: { duration: 0.8, ease: [0.65, 0, 0.35, 1], delay: 0.1 } },
};

const lineVariants = {
  hidden: { pathLength: 0 },
  visible: { pathLength: 1, transition: { duration: 0.45, ease: [0.65, 0, 0.35, 1], delay: 0.75 } },
};

const dotVariants = {
  hidden: { opacity: 0, scale: 0.35 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, ease: [0.34, 1.2, 0.64, 1], delay: 1.1 },
  },
};

export function SitusPortalMark({
  className,
  size = "sm",
  title = "Situs Portal",
  animated = false,
  onDrawComplete,
  ...props
}: React.SVGProps<SVGSVGElement> & {
  size?: PortalLogoSize;
  title?: string;
  /** Plays a one-shot stroke draw-on entrance (arc, then foundation line, then dot) instead of
   *  rendering fully formed. Meant for a single hero moment (e.g. the PWA welcome splash), not
   *  for repeated/small in-chrome usage. */
  animated?: boolean;
  /** Fires once the draw-on entrance finishes. Ignored when `animated` is false. */
  onDrawComplete?: () => void;
}): React.ReactElement {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      role="img"
      aria-label={title}
      className={cn(SIZE_CLASSES[size], "shrink-0", className)}
      {...props}
    >
      <circle
        cx="50"
        cy="50"
        r="44"
        fill="var(--logo-primary)"
        stroke="var(--logo-keyline)"
        strokeWidth="1.25"
        strokeDasharray="3 3"
        opacity="0.35"
      />
      <path
        d="M20 50 C20 33.4 33.4 20 50 20 C66.6 20 80 33.4 80 50"
        stroke="var(--logo-keyline)"
        strokeWidth="15"
        strokeLinecap="round"
      />
      {animated ? (
        <motion.path
          d="M20 50 C20 33.4 33.4 20 50 20 C66.6 20 80 33.4 80 50"
          stroke="var(--logo-primary)"
          strokeWidth="12"
          strokeLinecap="round"
          initial="hidden"
          animate="visible"
          variants={arcVariants}
        />
      ) : (
        <path
          d="M20 50 C20 33.4 33.4 20 50 20 C66.6 20 80 33.4 80 50"
          stroke="var(--logo-primary)"
          strokeWidth="12"
          strokeLinecap="round"
        />
      )}
      <path d="M20 72 H80" stroke="var(--logo-keyline)" strokeWidth="11" strokeLinecap="round" />
      {animated ? (
        <motion.path
          d="M20 72 H80"
          stroke="var(--logo-secondary)"
          strokeWidth="8"
          strokeLinecap="round"
          initial="hidden"
          animate="visible"
          variants={lineVariants}
        />
      ) : (
        <path d="M20 72 H80" stroke="var(--logo-secondary)" strokeWidth="8" strokeLinecap="round" />
      )}
      {animated ? (
        <motion.circle
          cx="50"
          cy="50"
          r="12"
          fill="var(--logo-accent)"
          stroke="var(--logo-keyline)"
          strokeWidth="1.25"
          initial="hidden"
          animate="visible"
          variants={dotVariants}
          onAnimationComplete={onDrawComplete}
        />
      ) : (
        <circle
          cx="50"
          cy="50"
          r="12"
          fill="var(--logo-accent)"
          stroke="var(--logo-keyline)"
          strokeWidth="1.25"
        />
      )}
    </svg>
  );
}

/** Full lockup: mark + "SITUS" wordmark (uppercase, wide tracking, per brand spec). */
export function SitusLogo({
  className,
  markClassName,
  size = "sm",
}: {
  className?: string;
  markClassName?: string;
  size?: PortalLogoSize;
}): React.ReactElement {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <SitusPortalMark size={size} className={markClassName} />
      <span className="text-meta font-medium uppercase tracking-[0.22em] text-[var(--color-foreground)]">
        Situs
      </span>
    </span>
  );
}
