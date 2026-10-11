import { SitusPortalMark } from "@/components/shared/situs-portal-logo";

/**
 * Brand loading screen. Calm, single focal moment: the Situs Portal mark on its
 * logo canvas panel, wordmark beneath and a slim indeterminate progress rail.
 * Motion is gated behind `motion-safe` so it honors `prefers-reduced-motion`.
 * i18n isn't available inside a loading boundary, so the only word shown is the
 * brand name.
 */
export default function Loading() {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[var(--color-background)] px-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex h-28 w-28 items-center justify-center border border-[var(--color-border)] bg-[var(--logo-canvas)]">
        <SitusPortalMark className="h-14 w-14" />
      </div>

      <div className="flex flex-col items-center gap-3">
        <span className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--color-foreground)]">
          Situs
        </span>
        {/* Slim indeterminate rail — reads as "official", not a busy spinner */}
        <span
          aria-hidden
          className="relative block h-0.5 w-40 overflow-hidden bg-[var(--color-border)]"
        >
          <span className="absolute inset-y-0 left-0 w-1/3 bg-[var(--country-highlight-readable)] motion-safe:animate-[loadingSlide_1.2s_ease-in-out_infinite]" />
        </span>
      </div>

      <span className="sr-only">Loading Situs…</span>
    </div>
  );
}
