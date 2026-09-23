import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Sidebar } from "@/components/layouts/sidebar";
import { MobileBottomNav, MobileTopBar } from "@/components/ui/mobile-nav";
import { SkipLink } from "@/components/ui/accessibility";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { PortalAccessGuard } from "@/components/shared/portal-access-guard";
import { EntityDetailRouteClient } from "@/components/shared/entity-detail-route-client";
import { AppDataGate } from "@/components/shared/app-data-gate";

export default async function MainLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal?: React.ReactNode;
}) {
  const t = await getTranslations("navigation");
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-background)]">
      {/* Skip Navigation Links for Accessibility */}
      <SkipLink href="#main-content">{t("skipToContent")}</SkipLink>
      <SkipLink href="#main-navigation">{t("skipToNavigation")}</SkipLink>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:flex-shrink-0" aria-label={t("sidebarLabel")}>
        <Sidebar />
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Sticky app-chrome header — mobile only (no sidebar below md). */}
        <MobileTopBar />

        {/* The bottom nav measures `1px border-t + h-16 + env(safe-area-inset-bottom)`
            (`components/ui/mobile-nav.tsx`), so a flat 4rem reservation left the last 24–48px of
            every page behind the bar on any device with a home indicator — and 1px behind it
            even without one. Reserve the same expression the nav is built from; the three terms
            here mirror its three. Invisible to `scripts/mobile-audit.mjs`, which runs in a
            context where the inset resolves to 0. */}
        <main
          id="main-content"
          className="flex-1 overflow-y-auto overscroll-y-contain pb-[calc(4rem+1px+env(safe-area-inset-bottom,0px))] md:pb-0"
          tabIndex={-1}
        >
          <div className="min-h-full p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
            {/* Breadcrumbs carry page context on desktop; on mobile the top bar does. */}
            <Breadcrumbs className="mb-4 hidden md:flex" />
            <ErrorBoundary component="MainContent">
              <PortalAccessGuard>
                {/* Renders the shared load/failure states. Without it every screen shows its
                    EMPTY state while the account-wide fetch is in flight, and keeps showing it
                    if that fetch fails — see app-data-gate.tsx. */}
                <AppDataGate>{children}</AppDataGate>
              </PortalAccessGuard>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav />

      {/* Entity detail overlay — mounted once so `?detail=<type>:<id>` works from any page */}
      <Suspense fallback={null}>
        <EntityDetailRouteClient />
      </Suspense>

      {/* Intercepting modal slot */}
      {modal}
    </div>
  );
}
