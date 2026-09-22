"use client";

import * as React from "react";
import { LogOut, Globe } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { signOut, useSession } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "./sheet";
import { LanguageSelector } from "@/components/shared/language-selector";
import { SitusPortalMark } from "@/components/shared/situs-portal-logo";
import { NotificationBell } from "@/components/shared/notification-bell";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { usePortalAccess } from "@/lib/contexts/portal-context";

interface MobileNavProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

/** Endonyms — the same in every catalog, so not routed through i18n. */
const LOCALE_LABELS: Record<string, string> = {
  pt: "Português",
  en: "English",
  es: "Español",
  it: "Italiano",
};

export function MobileBottomNav({
  activeTab: _activeTab,
  onTabChange,
}: MobileNavProps): React.ReactElement {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { mobilePrimaryNavigation, mobileSecondaryNavigation } = usePortalAccess();
  const tNav = useTranslations("navigation");
  const user = session?.user;
  const initials =
    user?.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() || "U";

  const currentLocale = useLocale();
  const primaryNavItems = mobilePrimaryNavigation.map((item) => ({
    id: item.key,
    label: tNav(item.labelKey.replace("navigation.", "") as Parameters<typeof tNav>[0]),
    icon: item.icon,
    href: item.href,
  }));
  // Everything not on the bottom bar (Leases, Documents, Messages, Compliance,
  // Settings…) has no other home on a phone — the desktop sidebar is hidden below
  // `md`. Surface it inside the "More" sheet so the whole app stays reachable from
  // mobile chrome, not just the 4 primary tabs.
  const secondaryNavItems = mobileSecondaryNavigation.map((item) => ({
    id: item.key,
    label: tNav(item.labelKey.replace("navigation.", "") as Parameters<typeof tNav>[0]),
    icon: item.icon,
    href: item.href,
  }));

  const isItemActive = (href: string) => {
    if (!href) return false;
    const fullPath = href;
    return pathname === fullPath || pathname.startsWith(`${fullPath}/`);
  };

  // Situs rectilinear: no pills, no radius. The active tab is marked by a 2px
  // country-highlight top border (mirroring the desktop rail's active left
  // border) rather than a rounded accent chip.
  const tabItemClass = (isActive: boolean) =>
    cn(
      "flex flex-col items-center justify-center gap-1 h-full px-1 pt-[calc(0.375rem-2px)] pb-1.5 border-t-2 transition-colors duration-200",
      "active:opacity-70 touch-manipulation",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus)]",
      isActive
        ? "border-[var(--country-highlight-readable)] text-[var(--country-highlight-readable)]"
        : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
    );

  const isSecondaryActive = secondaryNavItems.some((item) => isItemActive(item.href));

  // A single bottom bar: the primary tabs plus one "Account" tab that opens a
  // bottom sheet with profile utilities (language, settings, sign-out) — so the
  // most valuable strip on the phone isn't split across two rows.
  const columnCount = primaryNavItems.length + (session ? 1 : 0);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
      role="navigation"
      aria-label="Mobile navigation"
    >
      <div className="bg-[var(--color-background)]/95 backdrop-blur-sm border-t border-[var(--color-border)]">
        {/* The nav's true height is the wrapper's 1px `border-t` + this `h-16` + the safe-area
            spacer below. `<main>` reserves that same three-term expression as bottom padding
            (`app/[locale]/(main)/layout.tsx`) — change one and change the other, or content
            slides back under the bar. */}
        <div
          className="grid h-16 items-center px-2"
          style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
        >
          {primaryNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = isItemActive(item.href);
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => onTabChange?.(item.id)}
                className={tabItemClass(isActive)}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="text-[11px] font-medium tracking-tight">{item.label}</span>
              </Link>
            );
          })}

          {session && (
            <Sheet>
              <SheetTrigger className={tabItemClass(isSecondaryActive)} aria-label={tNav("more")}>
                <Avatar className="h-6 w-6 rounded-none ring-1 ring-[var(--color-border)]">
                  <AvatarImage src={user?.image || ""} alt={user?.name || "User"} />
                  <AvatarFallback className="rounded-none bg-[var(--country-highlight-readable)] text-[10px] font-semibold text-[var(--color-background)]">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[11px] font-medium tracking-tight">{tNav("more")}</span>
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="max-h-[85vh] overflow-y-auto rounded-none px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-5"
              >
                <SheetTitle className="sr-only">{tNav("more")}</SheetTitle>
                <div className="mb-4 flex items-center gap-3">
                  <Avatar className="h-11 w-11 ring-1 ring-[var(--color-border)]">
                    <AvatarImage src={user?.image || ""} alt={user?.name || "User"} />
                    <AvatarFallback className="bg-accent-primary text-white text-sm font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">
                      {user?.name}
                    </p>
                    <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                      {user?.email}
                    </p>
                  </div>
                </div>

                {/* Navigate — the rest of the app that isn't on the bottom bar. */}
                {secondaryNavItems.length > 0 && (
                  <div className="mb-2 grid grid-cols-2 gap-1.5">
                    {secondaryNavItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = isItemActive(item.href);
                      return (
                        <SheetClose asChild key={item.id}>
                          <Link
                            href={item.href}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-3 border-l-2 px-3 py-2.5 text-sm transition-colors",
                              isActive
                                ? "border-[var(--country-highlight-readable)] bg-[var(--color-sidebar-active)] font-medium text-[var(--country-highlight-readable)]"
                                : "border-transparent text-[var(--color-foreground)] hover:bg-[var(--color-hover)]",
                            )}
                          >
                            <Icon
                              className={cn(
                                "h-4 w-4 shrink-0",
                                !isActive && "text-[var(--color-muted-foreground)]",
                              )}
                            />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        </SheetClose>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-col divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                  <div className="flex items-center justify-between py-3">
                    <span className="flex items-center gap-3 text-sm text-[var(--color-foreground)]">
                      <Globe className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                      {LOCALE_LABELS[currentLocale] ?? currentLocale.toUpperCase()}
                    </span>
                    <LanguageSelector compact />
                  </div>
                  <button
                    onClick={() => signOut({ callbackUrl: "/" })}
                    className="flex items-center gap-3 py-3 text-sm text-[var(--color-error)]"
                  >
                    <LogOut className="h-4 w-4" />
                    {tNav("signOut")}
                  </button>
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
        <div
          className="bg-[var(--color-background)]"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        />
      </div>
    </nav>
  );
}

/**
 * Situs mobile top bar — the sticky app chrome shown below `md`, giving the
 * authenticated shell a native-app feel (there is no desktop sidebar on a
 * phone). It carries the Portal mark and the current section title, derived
 * from the active nav item so it stays i18n-correct and in sync with the rail.
 * Purely presentational: no menu toggle — navigation lives in the bottom bar.
 */
export function MobileTopBar(): React.ReactElement {
  const pathname = usePathname();
  const tNav = useTranslations("navigation");
  const { navigation } = usePortalAccess();

  // The URL carries no locale segment, so the path is already the route.
  const routePath = pathname;

  // Resolve the section title from the nav item whose href best matches the
  // current path (longest prefix wins, so "/settings/tax" still reads
  // "Settings"). Falls back to the wordmark when nothing matches.
  const items = navigation.flatMap((group) => group.items);
  const match = items
    .filter((item) => routePath === item.href || routePath.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const title = match
    ? tNav(match.labelKey.replace("navigation.", "") as Parameters<typeof tNav>[0])
    : "Situs";

  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-background)]/95 px-4 pt-[env(safe-area-inset-top,0px)] backdrop-blur md:hidden"
      style={{ height: "calc(3.5rem + env(safe-area-inset-top, 0px))" }}
    >
      <Link
        href={"/dashboard"}
        aria-label="Situs — Home"
        className="flex shrink-0 items-center justify-center max-md:min-h-11 max-md:min-w-11"
      >
        <SitusPortalMark size="sm" className="h-6 w-6" />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-[var(--color-foreground)]">
        {title}
      </h1>
      <div className="shrink-0">
        <NotificationBell />
      </div>
    </header>
  );
}
