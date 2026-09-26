"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";

import { readLocaleCookie, writeLocaleCookie } from "@/lib/i18n/locale-cookie";
import { useUserSettings } from "@/lib/contexts/user-settings-context";
import { apiFetch } from "@/lib/utils/api-client";

/**
 * Keeps this device's language and the account's in step, once per page load.
 *
 * - **A device whose language was chosen keeps it** (the `situs-locale` cookie is set), and the
 *   account follows when it differs: reminder emails go out in the language the owner last chose.
 *   A language picked on the sign-in page, before there was an account to save it to, reaches the
 *   account this way.
 * - **A device with no language of its own takes on the account's**, when the account chose one.
 *   The session carries it from sign-in (`auth.ts`), never from a later read: a choice made on
 *   another device does not switch a page someone is already using.
 *
 * Renders nothing.
 */
export function LanguageSync(): null {
  const { data: session, status } = useSession();
  const current = useLocale();
  const { settings, merge } = useUserSettings();
  const router = useRouter();
  const settled = useRef(false);

  useEffect(() => {
    if (settled.current || status !== "authenticated") return;
    const chosenHere = readLocaleCookie();

    if (!chosenHere) {
      settled.current = true;
      const chosenOnAccount = session?.locale;
      // Refresh only when the browser kept the cookie: without it the proxy would render the
      // same language again, and this would run again on the next page.
      if (chosenOnAccount && chosenOnAccount !== current && writeLocaleCookie(chosenOnAccount)) {
        router.refresh();
      }
      return;
    }

    if (!settings) return; // the account's row has not arrived yet
    settled.current = true;
    if (settings.language === chosenHere && settings.languageChosenAt) return;
    apiFetch("/api/settings/language", null, "PUT", { language: chosenHere })
      .then(() => merge({ language: chosenHere, languageChosenAt: new Date().toISOString() }))
      .catch(() => {
        // Nothing on screen depends on it; the next page load tries again.
      });
  }, [status, session?.locale, current, settings, merge, router]);

  return null;
}
