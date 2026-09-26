import { AppShell } from "@/components/layouts/app-shell";
import { AdminShellNav } from "@/components/features/admin/admin-shell-nav";

/**
 * The operator surface, in the app's own shell.
 *
 * It had a shell of its own, deliberately unlike the app: operator controls that look like app
 * screens get used like app screens. The owner asked for its navigation to match every other
 * page's (25 September), so the rail and the phone's bars are the app's now, and the page says
 * what it is instead: one heading, and a tab per section (`AdminShellNav`).
 *
 * What stays different is structural. The pages manage the *instance*, not a portfolio, and are
 * opened precisely when the app is broken, so the shell renders them without `AppDataGate` (see
 * `AppShell`'s `admin`).
 *
 * Access: `PortalAccessGuard` keeps the route reachable per `PORTAL_NAV_GROUPS`, but the real gate
 * is `requireAdmin` on every `/api/admin/*` route. A non-admin who reaches these pages sees empty
 * panels and a refusal, never instance detail.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell admin>
      <div className="space-y-6">
        <AdminShellNav />
        {children}
      </div>
    </AppShell>
  );
}
