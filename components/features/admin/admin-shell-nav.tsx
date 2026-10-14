"use client";

import { PageHeader } from "@/components/shared/page-header";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { TabLink, TabNav } from "@/components/ui/tabs";

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
  { key: "access", href: "/admin/access" },
] as const;

export function AdminShellNav() {
  const t = useTranslations("admin.shell");
  const pathname = usePathname();
  const current = pathname.replace(/\/$/, "") || "/admin";

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} />
      <TabNav aria-label={t("sections")}>
        {SECTIONS.map((section) => (
          <TabLink key={section.key} href={section.href} active={current === section.href}>
            {t(`nav.${section.key}`)}
          </TabLink>
        ))}
      </TabNav>
    </div>
  );
}

export default AdminShellNav;
