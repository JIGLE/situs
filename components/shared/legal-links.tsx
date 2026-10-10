"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils/utils";

/**
 * The way to the privacy notice and the terms.
 *
 * Nothing linked to either page: they existed, in four languages, and could be reached only by
 * typing the address. A privacy notice has to be reachable where an account is created, and the
 * bank registration asks for both URLs, so a reviewer opens the app and looks for them. They sit
 * under the sign-in form, small and muted, and in Settings. `min-h-11` keeps the tap target the
 * house rule asks for on a phone without making the line louder.
 */
export function LegalLinks({ className }: { className?: string }): React.ReactElement {
  const t = useTranslations("legal");
  const link =
    "inline-flex min-h-11 items-center px-1 underline-offset-4 hover:text-[var(--color-foreground)] hover:underline md:min-h-0";

  return (
    <nav
      aria-label={t("linksLabel")}
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-5 text-xs text-[var(--color-muted-foreground)]",
        className,
      )}
    >
      <Link href="/privacy" className={link}>
        {t("privacyTitle")}
      </Link>
      <Link href="/terms" className={link}>
        {t("termsTitle")}
      </Link>
    </nav>
  );
}
