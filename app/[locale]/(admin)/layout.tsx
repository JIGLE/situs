import { getTranslations } from "next-intl/server";
import { SkipLink } from "@/components/ui/accessibility";
import { PortalAccessGuard } from "@/components/shared/portal-access-guard";
import { AdminShellNav } from "@/components/features/admin/admin-shell-nav";

/**
 * The operator surface, deliberately not the app.
 *
 * `(main)` renders the portfolio sidebar, the command palette, breadcrumbs, the mobile bottom nav
 * and `AppDataGate`. None of that belongs here: these pages manage the *instance*, not a
 * portfolio, and several of them are opened precisely when the app is broken. `/admin` already
 * bypassed `AppDataGate` for that reason — a diagnostics screen that fails alongside the thing it
 * diagnoses is not a diagnostics screen — and this group makes that structural rather than a note
 * in one file.
 *
 * The visual departure is intentional too. Operator controls that look like app screens get used
 * like app screens, and the most destructive button in this product now lives behind one of them.
 *
 * Access: `PortalAccessGuard` keeps the route reachable per `PORTAL_NAV_GROUPS`, but the real gate
 * is `requireAdmin` on every `/api/admin/*` route. A non-admin who reaches these pages sees empty
 * panels and a refusal, never instance detail.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("navigation");
  return (
    <PortalAccessGuard>
      {/*
        Above `lg` the shell is exactly one viewport tall and clips: the control center is a grid
        sized to its container, and each panel scrolls inside its own box. `min-h-0` on the main
        element is the part that makes that work — without it a flex child refuses to shrink below
        its content and the overflow escapes to the page, which is the whole thing being avoided.

        Below `lg` it reverts to ordinary flow. A phone has no viewport to fit a control centre
        into, and forcing one produces several nested scroll areas competing for the same gesture.

        The width cap rises from `5xl` to `7xl`: five panels across two rows need the room, and
        the detail pages that kept the narrower measure set it themselves.
      */}
      <div className="flex min-h-screen flex-col bg-[var(--color-canvas)] lg:h-screen lg:min-h-0 lg:overflow-hidden">
        <SkipLink href="#admin-content">{t("skipToContent")}</SkipLink>
        <AdminShellNav />
        <main
          id="admin-content"
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:min-h-0 lg:overflow-hidden lg:py-6"
        >
          {children}
        </main>
      </div>
    </PortalAccessGuard>
  );
}
