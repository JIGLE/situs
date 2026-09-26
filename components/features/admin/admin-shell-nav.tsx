"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils/utils";

/**
 * Admin's page header: one heading, and a tab per section.
 *
 * It used to be a bar across the top of a shell of Admin's own, with a "Back to app" link. The
 * pages sit in the app's shell now, whose rail is the way back, so what is left is what every
 * other page has: its title, then its sections. Each section is a route, so these are links that
 * mark the current one, drawn like the app's tab bars. Every section's view leaves the heading to
 * this bar: the tab label is its heading.
 *
 * Three short labels fit at 390px in every language, so the bar stays a bar at every width.
 */
const SECTIONS = [
  { key: "overview", href: "/admin" },
  { key: "status", href: "/admin/status" },
  { key: "signIn", href: "/admin/sign-in" },
] as const;

export function AdminShellNav() {
  const t = useTranslations("admin.shell");
  const pathname = usePathname();
  const current = pathname.replace(/\/$/, "") || "/admin";

  return (
    <header className="space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--color-foreground)]">
        <ShieldCheck className="h-6 w-6" aria-hidden />
        {t("title")}
      </h1>
      <nav
        aria-label={t("sections")}
        className="flex items-center gap-1 overflow-x-auto border-b border-[var(--color-border)]"
      >
        {SECTIONS.map((section) => {
          const active = current === section.href;
          return (
            <Link
              key={section.key}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center justify-center whitespace-nowrap border border-b-0 px-3 py-2 font-mono text-[12px] uppercase tracking-[0.06em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--country-highlight-readable)] max-md:min-h-11 md:text-[10px]",
                active
                  ? "border-[var(--color-border)] border-t-2 border-t-[var(--country-highlight-readable)] bg-[var(--color-hover)] text-[var(--color-foreground)]"
                  : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
              )}
            >
              {t(`nav.${section.key}`)}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

export default AdminShellNav;
