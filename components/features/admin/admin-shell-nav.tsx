"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils/utils";

/**
 * The admin area's own nav.
 *
 * Three destinations and a way back. Deliberately not the app's `Sidebar`: this bar exists to make
 * "you are administering the instance" unmistakable, so it states that in words rather than
 * relying on the operator noticing which of nine rail items is highlighted.
 *
 * Active state is matched on the segment after the locale, so `/en/admin/users` highlights Users
 * without the locale prefix being hardcoded anywhere.
 */
const SECTIONS = [
  { key: "overview", href: "/admin" },
  { key: "status", href: "/admin/status" },
  { key: "signIn", href: "/admin/sign-in" },
] as const;

export function AdminShellNav() {
  const t = useTranslations("admin.shell");
  const pathname = usePathname();
  // Everything after the locale, so comparisons are locale-agnostic.
  const current = pathname.replace(/\/$/, "") || "/admin";

  return (
    <header className="border-b border-[var(--color-inner-border)] bg-[var(--color-surface-solid)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 pt-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)]">
            <ShieldCheck className="size-4 text-[var(--semantic-warning-readable)]" aria-hidden />
            {t("title")}
          </p>
          <Link
            href={"/dashboard"}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-[var(--color-foreground)]"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("backToApp")}
          </Link>
        </div>

        <nav aria-label={t("title")} className="-mb-px flex gap-1 overflow-x-auto">
          {SECTIONS.map((section) => {
            const active = current === section.href;
            return (
              <Link
                key={section.key}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                  // Was a filled pill in `--color-muted`, which is the same token the bar
                  // itself now sits on — the active tab would have been invisible against it.
                  // An underline in the country highlight cannot collide with its own surface.
                  active
                    ? "border-[var(--country-highlight-readable)] font-medium text-[var(--color-foreground)]"
                    : "border-transparent text-muted-foreground hover:text-[var(--color-foreground)]",
                )}
              >
                {t(`nav.${section.key}`)}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export default AdminShellNav;
