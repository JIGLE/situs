import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pageLocale } from "@/lib/i18n/page-title";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/shared/language-selector";
import { legalContactEmail } from "@/lib/legal/contact";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const t = await getTranslations({ locale: await pageLocale(params), namespace: "legal" });
  return {
    title: t("termsTitle"),
    description: "The terms under which this Situs instance is provided.",
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-medium text-[var(--color-foreground)]">{title}</h2>
      <div className="space-y-3 text-[var(--color-muted-foreground)]">{children}</div>
    </section>
  );
}

export default async function TermsPage({ params }: Props) {
  const t = await getTranslations({ locale: await pageLocale(params), namespace: "legal" });
  const email = legalContactEmail();

  return (
    <div className="min-h-dvh bg-[var(--color-background)] text-[var(--color-foreground)]">
      <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-background)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link
            href={"/"}
            className="text-sm font-semibold tracking-tight text-[var(--color-foreground)] transition-opacity hover:opacity-80"
          >
            Situs
          </Link>
          <LanguageSelector />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-16 sm:py-24">
        <div className="mb-12">
          <p className="mono-label mb-3 text-[var(--country-highlight-readable)]">{t("eyebrow")}</p>
          <h1 className="text-3xl font-normal tracking-[-0.03em] text-[var(--color-foreground)] sm:text-4xl">
            {t("termsTitle")}
          </h1>
          <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">{t("lastUpdated")}</p>
        </div>

        <div className="space-y-10 text-[15px] leading-7">
          <Section title={t("terms.acceptanceTitle")}>
            <p>{t("terms.acceptanceBody")}</p>
          </Section>

          <Section title={t("terms.serviceTitle")}>
            <p>{t("terms.serviceBody")}</p>
          </Section>

          <Section title={t("terms.accountsTitle")}>
            <ul className="ml-4 list-disc space-y-2">
              <li>{t("terms.accounts1")}</li>
              <li>{t("terms.accounts2")}</li>
              <li>{t("terms.accounts3")}</li>
              <li>{t("terms.accounts4")}</li>
            </ul>
          </Section>

          <Section title={t("terms.useTitle")}>
            <p>{t("terms.useIntro")}</p>
            <ul className="ml-4 list-disc space-y-2">
              <li>{t("terms.use1")}</li>
              <li>{t("terms.use2")}</li>
              <li>{t("terms.use3")}</li>
              <li>{t("terms.use4")}</li>
              <li>{t("terms.use5")}</li>
            </ul>
          </Section>

          {/* New section. A read-only PSD2 authorisation is a distinct undertaking from the rest
              of the service, and the terms said nothing about it at all. */}
          <Section title={t("terms.bankTitle")}>
            <p>{t("terms.bankBody")}</p>
          </Section>

          <Section title={t("terms.liabilityTitle")}>
            <p>{t("terms.liabilityBody")}</p>
          </Section>

          <Section title={t("terms.ipTitle")}>
            <p>{t("terms.ipBody")}</p>
          </Section>

          <Section title={t("terms.terminationTitle")}>
            <p>{t("terms.terminationBody")}</p>
          </Section>

          <Section title={t("terms.lawTitle")}>
            <p>{t("terms.lawBody")}</p>
          </Section>

          <Section title={t("terms.contactTitle")}>
            <p>
              {t("terms.contactBody")}{" "}
              <a
                href={`mailto:${email}`}
                className="text-[var(--country-highlight-readable)] underline-offset-4 hover:underline"
              >
                {email}
              </a>
            </p>
          </Section>

          <p className="border-t border-[var(--color-border)] pt-6 text-sm text-[var(--color-muted-foreground)]">
            {t("reviewNote")}
          </p>
        </div>

        <div className="mt-16 border-t border-[var(--color-border)] pt-8">
          <Button
            variant="ghost"
            asChild
            className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            <Link href={"/"}>&larr; {t("backToHome")}</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
