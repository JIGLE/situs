"use client";

import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRoutePathname } from "@/lib/hooks/use-route-pathname";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Globe, LogOut, Settings } from "lucide-react";

import { SitusPortalMark } from "@/components/shared/situs-portal-logo";
import { NotificationBell } from "@/components/shared/notification-bell";
import { cn } from "@/lib/utils/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { usePortalAccess } from "@/lib/contexts/portal-context";
import { useUserSettings } from "@/lib/contexts/user-settings-context";
import { countryName } from "@/lib/utils/countries";
import { locales, localeNames, type Locale } from "@/lib/i18n/locales";
import { useSetLanguage } from "@/lib/i18n/use-set-language";
import type { PortalNavItem } from "@/lib/portal/access";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ── Nav Item Type ──────────────────────────────────────
interface SidebarProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

const SIDEBAR_COLLAPSE_KEY = "situs.sidebar.collapsed";

// ── Account menu ───────────────────────────────────────
interface SidebarFooterProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  user?: { name?: string | null; email?: string | null; image?: string | null };
  /** Entries reached from the account (Settings), from the navigation's `accountMenu` items. */
  items: PortalNavItem[];
  pathname: string;
}

/**
 * The owner's row at the foot of the rail, and the menu it opens.
 *
 * Settings used to be a rail entry of its own, alone under a "Sistema" heading in the middle of
 * the rail, while this row opened Settings too: two ways in that looked like two places. Now the
 * row is the one way in, as the avatar is on the phone: it opens a menu with Settings, the
 * language and sign-out, the same three things as the phone's More sheet. The row lights up in
 * the accent while a page it leads to is open, since no rail entry does then.
 */
function SidebarFooter({
  collapsed,
  onToggleCollapsed,
  user,
  items,
  pathname,
}: SidebarFooterProps): React.ReactElement {
  const tNav = useTranslations("navigation");
  const tLanguage = useTranslations("language");
  const locale = useLocale() as Locale;
  const setLanguage = useSetLanguage();
  const { settings } = useUserSettings();
  const initials =
    user?.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() || "U";
  const active = items.some((item) => isItemActive(item, pathname));

  const avatar = (
    <Avatar className="w-8 h-8 shrink-0 ring-2 ring-[var(--color-inner-border)]">
      <AvatarImage src={user?.image || ""} alt={user?.name || "User"} />
      <AvatarFallback className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold">
        {initials}
      </AvatarFallback>
    </Avatar>
  );

  const menu = (
    <DropdownMenuContent
      side={collapsed ? "right" : "top"}
      align={collapsed ? "end" : "start"}
      className="w-56"
    >
      <DropdownMenuLabel className="min-w-0 font-normal">
        <p className="truncate text-sm font-medium text-[var(--color-foreground)]">
          {user?.name || "Portal User"}
        </p>
        {user?.email && (
          <p className="truncate text-xs text-[var(--color-muted-foreground)]">{user.email}</p>
        )}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <DropdownMenuItem key={item.key} asChild className="cursor-pointer gap-2">
            <Link href={item.href} aria-current={isItemActive(item, pathname) ? "page" : undefined}>
              <Icon className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              {tNav(item.labelKey.replace("navigation.", "") as Parameters<typeof tNav>[0])}
            </Link>
          </DropdownMenuItem>
        );
      })}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="cursor-pointer gap-2">
          <Globe className="h-4 w-4 text-[var(--color-muted-foreground)]" />
          <span className="flex-1">{tLanguage("label")}</span>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {localeNames[locale]}
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {locales.map((option) => (
            <DropdownMenuItem
              key={option}
              onClick={() => void setLanguage(option)}
              className={cn("cursor-pointer", option === locale && "font-medium")}
            >
              {localeNames[option]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => signOut({ callbackUrl: "/" })}
        className="cursor-pointer gap-2 text-[var(--color-destructive)] focus:text-[var(--color-destructive)]"
      >
        <LogOut className="h-4 w-4" />
        {tNav("signOut")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  if (!collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={tNav("account")}
            aria-label={tNav("account")}
            className={cn(
              "flex min-h-11 w-full min-w-0 items-center gap-3 border-l-2 px-2 py-2 text-left transition-colors hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--country-highlight-readable)]",
              active
                ? "border-[var(--country-highlight-readable)] bg-[var(--color-sidebar-active)]"
                : "border-transparent",
            )}
          >
            {avatar}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--color-foreground)] truncate">
                {user?.name || "Portal User"}
              </p>
              <p className="mono-label truncate" title={tNav("languageAndResidence")}>
                {/* The language on screen, then the country of tax residence named in it. A
                    missing row reads Portugal, the column's default. */}
                {`${locale.toUpperCase()} · ${countryName(settings?.residenceCountry ?? "PT", locale)}`}
              </p>
            </div>
            <Settings
              aria-hidden="true"
              className={cn(
                "h-4 w-4 shrink-0",
                active
                  ? "text-[var(--country-highlight-readable)]"
                  : "text-[var(--color-muted-foreground)]",
              )}
            />
          </button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    );
  }

  // Collapsed, the header row is one button (the logo expands the rail) with no room beside it,
  // so the bell joins this column, above the avatar.
  return (
    <div className="flex flex-col items-center gap-2">
      <NotificationBell className="h-8 w-8" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--country-highlight-readable)]",
              active && "ring-2 ring-[var(--country-highlight-readable)]",
            )}
            title={tNav("account")}
            aria-label={tNav("account")}
          >
            {avatar}
          </button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleCollapsed}
        className="h-8 w-8 p-0 text-[var(--color-muted-foreground)]"
        title={tNav("expandSidebar")}
        aria-label={tNav("expandSidebar")}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Whether `item` is the page open now: its own route, or one it stands for (`activeFor`). */
function isItemActive(item: PortalNavItem, pathname: string): boolean {
  return [item.href, ...(item.activeFor ?? [])].some(
    (href) => pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`)),
  );
}

export function Sidebar({ onTabChange }: SidebarProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const { data: session } = useSession();
  const pathname = useRoutePathname();
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

  // The rail lists the daily sections; an entry reached from the account (Settings) is in the
  // menu under the owner's name instead, so a group left empty by that is dropped too.
  const menuItems = navigation
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.accountMenu) }))
    .filter((group) => group.items.length > 0);
  const accountItems = navigation.flatMap((group) =>
    group.items.filter((item) => item.accountMenu),
  );

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
        "glass-sidebar relative flex h-dvh flex-col transition-all duration-300 min-w-0 overflow-x-hidden",
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
            title={t("expandSidebar")}
            aria-label={t("expandSidebar")}
          >
            <SitusPortalMark className="h-7 w-7" />
          </button>
        ) : (
          // Expanded: logo + collapse button
          <>
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <SitusPortalMark className="h-7 w-7 shrink-0" />
              <span className="text-meta font-medium uppercase tracking-[0.22em] text-[var(--color-foreground)] truncate">
                Situs
              </span>
            </div>
            {/* The bell shares the header row with the collapse button, at the same size. It had
                a bordered row of its own under the header: a whole row between the logo and the
                navigation for one icon. */}
            <NotificationBell className="h-8 w-8" />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleCollapsed}
              className="h-8 w-8 p-0 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              title={t("collapseSidebar")}
              aria-label={t("collapseSidebar")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav
        id="main-navigation"
        aria-label={t("mainNavLabel")}
        className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-2 py-3"
      >
        {menuItems.map((group, groupIndex) => (
          <div key={group.group} role="group" className={cn("space-y-1", groupIndex > 0 && "mt-2")}>
            {/* The first group is the app itself and needs no title; only later groups are named. */}
            {!collapsed && groupIndex > 0 && (
              <div className="px-3 pb-0.5 pt-2">
                <h3 className="mono-label">
                  {t(group.groupLabelKey.replace("navigation.", "") as Parameters<typeof t>[0])}
                </h3>
              </div>
            )}

            <div className="space-y-0.5" role="list">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = isItemActive(item, pathname);

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
            items={accountItems}
            pathname={pathname}
          />
        </div>
      )}
    </div>
  );
}
