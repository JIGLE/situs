"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/lib/contexts/theme-context";
import type { ThemeMode } from "@/lib/theme/mode";
import { cn } from "@/lib/utils/utils";

const OPTIONS: Array<{ value: ThemeMode; icon: typeof Sun }> = [
  { value: "dark", icon: Moon },
  { value: "normal", icon: Sun },
  { value: "system", icon: Monitor },
];

/**
 * The theme control for the pages that have no Settings: sign-in and sign-up.
 *
 * Settings › Appearance is behind the sign-in, so a signed-out person whose device had stored
 * Light had no way to change it, and nothing to say the choice existed. Dark is the default for a
 * device that never chose; this makes Light and "follow my phone" one tap away. It goes through
 * the same `setTheme` as Settings, which also keeps the choice in the cookie the server draws the
 * next page from.
 */
export function ThemeSwitcher({ className }: { className?: string }): React.ReactElement {
  const t = useTranslations("common");
  const tPanel = useTranslations("settings.panel");
  const { theme, resolvedTheme, setTheme } = useTheme();

  const labels: Record<ThemeMode, string> = {
    dark: t("themeDark"),
    normal: t("themeLight"),
    system: tPanel("themeSystem"),
  };
  const TriggerIcon = theme === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "text-[var(--color-muted-foreground)] hover:bg-white/5 hover:text-[var(--color-foreground)]",
            className,
          )}
          title={t("changeTheme")}
          aria-label={t("changeTheme")}
        >
          <TriggerIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {OPTIONS.map(({ value, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className={cn("cursor-pointer gap-2", value === theme && "bg-accent font-medium")}
          >
            <Icon className="h-4 w-4" />
            <span className="text-sm">{labels[value]}</span>
            {value === theme && <Check className="ml-auto h-4 w-4" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
