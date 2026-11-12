"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { Panel } from "@/components/shared/panel";

/** Admin's sections, as its own tab bar names them (`admin-shell-nav.tsx`). */
const ADMIN_SECTIONS = [
  { key: "overview", href: "/admin" },
  { key: "status", href: "/admin/status" },
  { key: "access", href: "/admin/access" },
] as const;

/**
 * Settings › Administration: the way into the instance's administration, which used to be an
 * entry of its own in the menu. Admin keeps its pages, since they are opened when the app itself
 * is broken and read nothing the app loads; this lists them where the instance's other settings
 * are. The admin APIs refuse anyone but an administrator, whatever reaches the pages.
 */
export function SettingsSystem() {
  const t = useTranslations("settings.panel");
  const tAdmin = useTranslations("admin.shell");

  return (
    <Panel title={tAdmin("title")} description={t("adminHelp")}>
      <ul className="divide-y divide-[var(--color-border)]">
        {ADMIN_SECTIONS.map((section) => (
          <li key={section.key}>
            <Link
              href={section.href}
              className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-[var(--color-muted)]"
            >
              {tAdmin(`nav.${section.key}`)}
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default SettingsSystem;
