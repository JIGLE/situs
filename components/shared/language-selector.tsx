"use client";

import { useLocale, useTranslations } from "next-intl";
import { locales, localeNames, type Locale } from "@/lib/i18n/config";
import { useSetLanguage } from "@/lib/i18n/use-set-language";
import { cn } from "@/lib/utils/utils";
import { Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const localeFlags: Record<Locale, string> = {
  pt: "🇵🇹",
  en: "🇬🇧",
  es: "🇪🇸",
  it: "🇮🇹",
};

const localeCodes: Record<Locale, string> = {
  pt: "PT",
  en: "EN",
  es: "ES",
  it: "IT",
};

interface LanguageSelectorProps {
  /** Compact mode shows only the flag/icon */
  compact?: boolean;
  className?: string;
}

/**
 * The language control on the pages outside the signed-in shell: sign-in, privacy and terms.
 * Inside the shell the account menu offers the same choice. Both switch through `useSetLanguage`,
 * which also saves the choice to the account when someone is signed in.
 */
export function LanguageSelector({ compact = false, className }: LanguageSelectorProps) {
  const t = useTranslations("language");
  const setLanguage = useSetLanguage();

  // Read the active locale from the provider rather than the URL: the auth pages sit outside
  // the `[locale]` segment and resolve their locale from the cookie, so there is nothing in
  // the path to parse there.
  const currentLocale = useLocale() as Locale;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          // `icon` carries both the min-h and min-w touch-target floors; `sm` + a manual
          // `h-9 w-9` only ever picked up the height one, leaving this trigger 36px wide.
          size={compact ? "icon" : "sm"}
          className={cn(
            "gap-1.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-white/5",
            compact ? "" : "h-9 px-2.5",
            className,
          )}
          title={t("label")}
          aria-label={t("change")}
        >
          {compact ? (
            <Globe className="h-4 w-4" />
          ) : (
            <>
              <Globe className="h-3.5 w-3.5" />
              <span className="text-xs font-medium tracking-wide">
                {localeCodes[currentLocale]}
              </span>
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {locales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => void setLanguage(locale)}
            className={cn(
              "gap-2 cursor-pointer",
              locale === currentLocale && "bg-accent font-medium",
            )}
          >
            <span className="text-base leading-none">{localeFlags[locale]}</span>
            <span className="text-sm">{localeNames[locale]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
