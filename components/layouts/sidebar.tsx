"use client";

import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ChevronLeft, ChevronRight, LogOut } from "lucide-react";

import { SitusPortalMark } from "@/components/shared/situs-portal-logo";
import { cn } from "@/lib/utils/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useDemoMode } from "@/lib/contexts/demo-context";
import { usePortalAccess } from "@/lib/contexts/portal-context";
import { useTheme } from "@/lib/contexts/theme-context";

// ── Nav Item Type ──────────────────────────────────────
interface SidebarProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

const SIDEBAR_COLLAPSE_KEY = "situs.sidebar.collapsed";

// ── Sidebar Footer ─────────────────────────────────────
interface SidebarFooterProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  user?: { name?: string | null; email?: string | null; image?: string | null };
  subtitle?: string | null;
}

function SidebarFooter({
  collapsed,
  onToggleCollapsed,
  user,
  subtitle,
}: SidebarFooterProps): React.ReactElement {
  const { country, resolvedTheme } = useTheme();
  const tNav = useTranslations("navigation");
  const tSettings = useTranslations("settings.nav");
  const initials =
    user?.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() || "U";

  if (!collapsed) {
    return (
      // One row, not two. The footer used to stack three lines of text — name, email, then
      // `country · mode` on a row of its own next to the sign-out button — which made the
      // bottom of the sidebar as tall as a whole nav group for what is one identity.
      //
      // The email is the line that goes: it is the least glanceable of the three, and it is
      // already on the account page this row opens. `country · mode` stays because it is live
      // app state you want to see without clicking. In demo mode `subtitle` still wins, so the
      // demo perspective keeps its place.
      //
      // The sign-out button is a sibling of the link rather than inside it — an anchor cannot
      // contain a button, and the previous layout only avoided that by giving the button its
      // own row.
      <div className="flex items-center gap-1">
        {/* The name is the way into the account. It used to be an inert <div>, so the only
            route to account settings was a nav row of its own; that row is gone now. */}
        <Link
          href={"/settings?tab=account"}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--country-highlight-readable)]"
          title={tNav("account")}
        >
          <Avatar className="w-8 h-8 ring-2 ring-[var(--color-inner-border)]">
            <AvatarImage src={user?.image || ""} alt={user?.name || "User"} />
            <AvatarFallback className="bg-[var(--color-primary)] text-white text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--color-foreground)] truncate">
              {user?.name || "Portal User"}
            </p>
            <p className="mono-label truncate" title={tSettings("appearance")}>
              {subtitle ?? `${country} · ${resolvedTheme}`}
            </p>
          </div>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="h-8 w-8 shrink-0 p-0 hover:bg-[var(--color-error-muted)] hover:text-[var(--color-destructive)]"
          title="Sign Out"
          aria-label="Sign Out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Link
        href={"/settings?tab=account"}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--country-highlight-readable)]"
        title={tNav("account")}
      >
        <Avatar className="w-8 h-8 ring-2 ring-[var(--color-inner-border)]">
          <AvatarImage src={user?.image || ""} alt={user?.name || "User"} />
          <AvatarFallback className="bg-[var(--color-primary)] text-white text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
      </Link>
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleCollapsed}
        className="h-8 w-8 p-0 text-[var(--color-muted-foreground)]"
        title="Expand Sidebar"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function Sidebar({ onTabChange }: SidebarProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const { data: session } = useSession();
  const pathname = usePathname();
  const { isDemoMode, demoPerspective } = useDemoMode();
  const { navigation } = usePortalAccess();
  const t = useTranslations("navigation");

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
      if (storedValue !== null) {
        setCollapsed(storedValue === "true");
      }
    } catch {
      // Ignore storage access issues
    }
  }, []);

  // Build menu from config
  const menuItems = navigation;

  const handleToggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, String(next));
      } catch {
        // Ignore storage access issues
      }
      return next;
    });
  }, []);

  const user = session?.user;

  return (
    <div
      className={cn(
        "glass-sidebar relative flex h-screen flex-col transition-all duration-300 min-w-0 overflow-x-hidden",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Header */}
      <div className="flex h-14 items-center border-b border-[var(--color-inner-border)] px-3">
        {collapsed ? (
          // Collapsed: centered logo that expands on click
          <button
            onClick={handleToggleCollapsed}
            className="w-full flex items-center justify-center h-full"
            title="Expand Sidebar"
            aria-label="Expand Sidebar"
          >
            <SitusPortalMark className="h-7 w-7" />
          </button>
        ) : (
          // Expanded: logo + collapse button
          <>
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <SitusPortalMark className="h-7 w-7 shrink-0" />
              <span className="text-[13px] font-medium uppercase tracking-[0.22em] text-[var(--color-foreground)] truncate">
                Situs
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleCollapsed}
              className="h-8 w-8 p-0 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              title="Collapse Sidebar"
              aria-label="Collapse Sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav
        id="main-navigation"
        aria-label="Main navigation"
        className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-2 py-3"
      >
        {menuItems.map((group, groupIndex) => (
          <div key={group.group} role="group" className={cn("space-y-1", groupIndex > 0 && "mt-2")}>
            {!collapsed && (
              <div className="px-3 pb-0.5 pt-2">
                <h3 className="mono-label">
                  {t(group.groupLabelKey.replace("navigation.", "") as Parameters<typeof t>[0])}
                </h3>
              </div>
            )}

            <div className="space-y-0.5" role="list">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

                const translatedLabel = t(
                  item.labelKey.replace("navigation.", "") as Parameters<typeof t>[0],
                );
                return (
                  // `role="listitem"` belongs on a wrapper, not on the anchor. It used to sit on
                  // the `Link` itself — presumably to satisfy the parent `role="list"` — but an
                  // explicit role REPLACES the implicit one, so every item in the main navigation
                  // was exposed as a list item and not as a link. A screen reader announced
                  // "Portfolio, list item"; `getByRole("link", …)` matched nothing at all, which
                  // is why the desktop half of the E2E navigation tests could never have worked
                  // even with their guards removed. The `aria-current="page"` below is only
                  // meaningful on a link, so the anchor was always intended to be one.
                  <div key={item.key} role="listitem">
                    <Link
                      href={item.href}
                      onClick={() => onTabChange?.(item.key)}
                      aria-current={isActive ? "page" : undefined}
                      title={collapsed ? translatedLabel : undefined}
                    >
                      <div
                        className={cn(
                          "flex items-center gap-3 border-l-2 px-3 py-1.5 text-sm transition-colors",
                          collapsed && "justify-center px-2",
                          isActive
                            ? "border-[var(--country-highlight-readable)] bg-[var(--color-sidebar-active)] font-medium text-[var(--country-highlight-readable)]"
                            : "border-transparent text-[var(--color-sidebar-text)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)]",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-[18px] w-[18px] shrink-0",
                            isActive && "text-[var(--country-highlight-readable)]",
                          )}
                        />
                        {!collapsed && <span className="truncate">{translatedLabel}</span>}
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>

            {/* No separator between groups. The boundary was being marked three times over — a
                gap, a `.mono-label` heading, and a rule — for two groups of a handful of links
                each. The heading stays because it names the group, which a rule cannot; the rule
                only added a line to look past. (It was also the one element here that had to
                fight the nav's own width: `Separator` bakes in `w-full`, so it needed `w-auto`
                to stop `mx-3` pushing it into the `overflow-x-hidden` clip. Deleting it retires
                that problem rather than carrying the workaround.) */}
          </div>
        ))}
      </nav>

      {/* User Profile */}
      {session && (
        <div className="flex-none border-t border-[var(--color-inner-border)] p-2">
          <SidebarFooter
            collapsed={collapsed}
            onToggleCollapsed={handleToggleCollapsed}
            user={user}
            // Demo perspective only. This used to fall back to the email, which is why the
            // secondary line under the name rendered as an address — the least glanceable thing
            // that could go there, and already on the account page this row opens. Undefined
            // lets the footer show `country · mode`, which is live state worth a glance.
            subtitle={isDemoMode ? `Demo ${demoPerspective}` : undefined}
          />
        </div>
      )}
    </div>
  );
}
