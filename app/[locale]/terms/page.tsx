import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/shared/language-selector";
import { legalContactEmail } from "@/lib/legal/contact";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return {
    title: `${t("termsTitle")} — Situs`,
    description: "The terms under which this Situs instance is provided.",
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-zinc-100">{title}</h2>
      <div className="space-y-3 text-zinc-400">{children}</div>
    </section>
  );
}

export default async function TermsPage() {
  const t = await getTranslations("legal");
  const email = legalContactEmail();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300">
      <header className="sticky top-0 z-50 border-b border-white/[0.04] bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link
            href={"/"}
            className="text-sm font-semibold tracking-tight text-zinc-50 transition-opacity hover:opacity-80"
          >
            Situs
          </Link>
          <LanguageSelector />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-16 sm:py-24">
        <div className="mb-12">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-indigo-400">
            {t("eyebrow")}
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
            {t("termsTitle")}
          </h1>
          <p className="mt-3 text-sm text-zinc-500">{t("lastUpdated")}</p>
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

          <Section title={t("terms.paymentTitle")}>
            <ul className="ml-4 list-disc space-y-2">
              <li>{t("terms.payment1")}</li>
              <li>{t("terms.payment2")}</li>
              <li>{t("terms.payment3")}</li>
              <li>{t("terms.payment4")}</li>
            </ul>
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
                className="text-indigo-400 underline-offset-4 hover:underline"
              >
                {email}
              </a>
            </p>
          </Section>

          <p className="border-t border-white/[0.06] pt-6 text-sm text-zinc-500">
            {t("reviewNote")}
          </p>
        </div>

        <div className="mt-16 border-t border-white/[0.06] pt-8">
          <Button variant="ghost" asChild className="text-zinc-500 hover:text-zinc-300">
            <Link href={"/"}>&larr; {t("backToHome")}</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
