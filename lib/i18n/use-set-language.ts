"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";

import type { Locale } from "@/lib/i18n/config";
import { writeLocaleCookie } from "@/lib/i18n/locale-cookie";
import { useUserSettings } from "@/lib/contexts/user-settings-context";
import { apiFetch } from "@/lib/utils/api-client";
import { logger } from "@/lib/utils/logger";

/**
 * The one way the interface changes language: the account menu, the phone's More sheet, and the
 * language control on the sign-in, privacy and terms pages all call it.
 *
 * The interface reads the `situs-locale` cookie, so writing it and re-rendering is the switch. A
 * signed-in owner's choice is also saved to the account (`PUT /api/settings/language`): reminder
 * emails are written in it, and a device with no language of its own takes it on at sign-in.
 *
 * Settings › Appearance used to have a language select that saved only the account's copy. The
 * screen never read it, so choosing a language there changed nothing on screen.
 */
export function useSetLanguage(): (locale: Locale) => Promise<void> {
  const router = useRouter();
  const current = useLocale();
  const { status } = useSession();
  const { merge } = useUserSettings();

  return useCallback(
    async (locale: Locale) => {
      if (locale === current) return;
      writeLocaleCookie(locale);
      if (status === "authenticated") {
        try {
          await apiFetch("/api/settings/language", null, "PUT", { language: locale });
          merge({ language: locale, languageChosenAt: new Date().toISOString() });
        } catch (err) {
          // The screen follows the cookie either way. `LanguageSync` saves a device's language
          // to the account on the next page load, so the account catches up then.
          logger.warn("Could not save the chosen language to the account", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      router.refresh();
    },
    [current, status, merge, router],
  );
}
