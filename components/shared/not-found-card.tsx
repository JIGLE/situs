import { FileX, Home } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Locale } from "@/lib/i18n/locales";

/**
 * The "page not found" card, shared by the one inside the signed-in area
 * (`app/[locale]/(main)/not-found.tsx`) and the root one (`app/not-found.tsx`) that answers every
 * other unknown address.
 *
 * The root one has no `[locale]` segment to read, so it passes the locale it resolved from the
 * cookie. The button goes to `/`, which the proxy sends on to the dashboard for a signed-in
 * visitor and to sign-in for anyone else; the card used to link to `/en/dashboard`, which sent
 * every language to the English prefix first.
 */
export async function NotFoundCard({ locale }: { locale?: Locale }) {
  const t = locale
    ? await getTranslations({ locale, namespace: "errors.notFound" })
    : await getTranslations("errors.notFound");

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FileX className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/">
              <Home className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("returnHome")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
