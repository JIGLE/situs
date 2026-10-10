import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { NotFoundCard } from "@/components/shared/not-found-card";
import { getPreferredLocale } from "@/lib/i18n/server-locale";

/**
 * Every address that matches no page. Only `app/[locale]/(main)/not-found.tsx` existed, and that
 * one answers a `notFound()` raised inside the signed-in area, so anything else got Next's plain
 * English default. There is no `[locale]` segment here, so the language is the cookie's.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({
    locale: await getPreferredLocale(),
    namespace: "errors.notFound",
  });
  return { title: t("title") };
}

export default async function RootNotFound() {
  return <NotFoundCard locale={await getPreferredLocale()} />;
}
