"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { useApp } from "@/lib/contexts/app-context";
import { Button } from "@/components/ui/button";
import {
  DashboardSkeleton,
  FinancialSkeleton,
  GenericPageSkeleton,
  LeasesSkeleton,
  PeopleListSkeleton,
  PropertiesListSkeleton,
} from "@/components/ui/page-skeletons";

/**
 * Renders the account-wide load and failure states that every screen shares.
 *
 * WHY THIS IS CENTRAL. Loading and error already WERE central — `use-app-data.ts` dispatches
 * SET_LOADING and SET_ERROR around one fetch that populates every entity. What was missing is
 * anyone reading them: `state.loading` was consumed by 2 components out of 27 screens, and
 * `state.error` by none at all. `page-skeletons.tsx` shipped seven purpose-built skeletons and
 * nothing imported them.
 *
 * The consequence is a screen that states something false, which is the same failure the
 * connector UI had. While the fetch is in flight every list is `[]`, so a landlord on a slow
 * connection is told "No properties yet" — not "loading" — on an account with forty properties.
 * If the fetch then FAILS, the only signal is a toast that auto-dismisses; the screen settles
 * on the same empty state permanently, with no error, no explanation and no way to retry short
 * of reloading the page.
 *
 * `app/[locale]/(main)/loading.tsx` does not cover this. That is Next's route-level Suspense
 * fallback — it covers navigation, and is gone by the time the client-side context fetch starts.
 *
 * Fixing it in one place rather than in 25 screens follows the data: there is one fetch and one
 * pair of flags, so there should be one gate.
 */

/**
 * Skeleton per route section, so the placeholder has the shape of what is arriving rather than
 * being a generic grey page. Longest prefixes first — `/financials` and `/finance` would
 * otherwise collide.
 */
const SKELETON_BY_SEGMENT: [string, React.ComponentType<{ className?: string }>][] = [
  ["/portfolio", PropertiesListSkeleton],
  ["/properties", PropertiesListSkeleton],
  ["/buildings", PropertiesListSkeleton],
  ["/financials", FinancialSkeleton],
  ["/finance", FinancialSkeleton],
  ["/people", PeopleListSkeleton],
  ["/tenants", PeopleListSkeleton],
  ["/owners", PeopleListSkeleton],
  ["/leases", LeasesSkeleton],
  ["/contracts", LeasesSkeleton],
  ["/dashboard", DashboardSkeleton],
  ["/overview", DashboardSkeleton],
];

function skeletonFor(pathname: string): React.ComponentType<{ className?: string }> {
  const match = SKELETON_BY_SEGMENT.find(([segment]) => pathname.includes(segment));
  return match ? match[1] : GenericPageSkeleton;
}

/**
 * Routes that must render even when the account-wide fetch is failing.
 *
 * The admin status page exists to explain WHY the app is broken — schema drift, an unreachable
 * database, a misconfigured connector. Putting it behind this gate would mean the one screen
 * that can diagnose a failure is replaced by a generic "couldn't load your data" the moment
 * that failure occurs. It reads `/api/admin/system-status` directly and depends on nothing in
 * AppContext, so it has no reason to wait for it either.
 */
const GATE_EXEMPT = ["/admin"];

export function AppDataGate({ children }: { children: React.ReactNode }) {
  const { state, refreshData } = useApp();
  const pathname = usePathname();
  const t = useTranslations("common");

  const Skeleton = useMemo(() => skeletonFor(pathname ?? ""), [pathname]);

  if (GATE_EXEMPT.some((segment) => (pathname ?? "").includes(segment))) {
    return <>{children}</>;
  }

  // Error wins over loading: a retry that is already in flight should keep the failure visible
  // rather than flicking back to a skeleton, so the user can see that their retry is the reason
  // anything is happening.
  if (state.error) {
    return (
      <div
        role="alert"
        className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-[var(--semantic-danger-soft)]">
          <AlertTriangle
            className="size-6 text-[var(--semantic-danger-readable)]"
            aria-hidden="true"
          />
        </span>
        <div className="space-y-1">
          <h2 className="text-lg font-medium text-[var(--color-foreground)]">
            {t("loadFailedTitle")}
          </h2>
          {/* The reason comes from the fetch layer, which already rewrites a 403 into
              "Security token expired. Please refresh the page." Showing it beats a generic
              line, because the two failures need different actions from the user. */}
          <p className="max-w-md text-sm text-[var(--color-muted-foreground)]">{state.error}</p>
        </div>
        <Button onClick={() => refreshData()} disabled={state.loading} variant="secondary">
          <RefreshCw className={`size-4 ${state.loading ? "animate-spin" : ""}`} aria-hidden />
          {state.loading ? t("retrying") : t("retry")}
        </Button>
      </div>
    );
  }

  // Only stand in for the FIRST load. A background refresh (refreshData after a mutation) keeps
  // the current screen on screen — replacing a populated page with a skeleton on every save
  // would be a worse experience than the bug being fixed.
  const isInitialLoad =
    state.loading &&
    state.properties.length === 0 &&
    state.tenants.length === 0 &&
    state.leases.length === 0;

  if (isInitialLoad) {
    return <Skeleton />;
  }

  return <>{children}</>;
}
