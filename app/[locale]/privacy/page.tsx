import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/shared/language-selector";
import { dataProtectionEmail } from "@/lib/legal/contact";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return {
    title: `${t("privacyTitle")} — Situs`,
    description: "How Situs collects, uses, and protects your personal data.",
  };
}

/** Section shell — one heading, then whatever the section needs. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-zinc-100">{title}</h2>
      <div className="space-y-3 text-zinc-400">{children}</div>
    </section>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li>
      <strong className="text-zinc-300">{label}:</strong> {children}
    </li>
  );
}

export default async function PrivacyPage() {
  const t = await getTranslations("legal");
  const email = dataProtectionEmail();

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
            {t("privacyTitle")}
          </h1>
          <p className="mt-3 text-sm text-zinc-500">{t("lastUpdated")}</p>
        </div>

        <div className="space-y-10 text-[15px] leading-7">
          <Section title={t("privacy.introTitle")}>
            <p>{t("privacy.intro")}</p>
          </Section>

          <Section title={t("privacy.collectTitle")}>
            <ul className="ml-4 list-disc space-y-2">
              <Term label={t("privacy.collectAccount")}>{t("privacy.collectAccountBody")}</Term>
              <Term label={t("privacy.collectProperty")}>{t("privacy.collectPropertyBody")}</Term>
              <Term label={t("privacy.collectBank")}>{t("privacy.collectBankBody")}</Term>
              <Term label={t("privacy.collectPayment")}>{t("privacy.collectPaymentBody")}</Term>
            </ul>
          </Section>

          <Section title={t("privacy.useTitle")}>
            <ul className="ml-4 list-disc space-y-2">
              <li>{t("privacy.use1")}</li>
              <li>{t("privacy.use2")}</li>
              <li>{t("privacy.use3")}</li>
              <li>{t("privacy.use4")}</li>
              <li>{t("privacy.use5")}</li>
            </ul>
          </Section>

          {/* Its own section rather than a bullet under "data we collect": this is the most
              sensitive category the app holds, and a PSD2 authorisation is a thing the reader
              actively grants rather than something that merely happens to them. */}
          <Section title={t("privacy.bankTitle")}>
            <p>{t("privacy.bankBody")}</p>
            <p>{t("privacy.bankStorage")}</p>
            <p>{t("privacy.bankRetention")}</p>
          </Section>

          <Section title={t("privacy.retentionTitle")}>
            <p>{t("privacy.retentionIntro")}</p>
            <ul className="ml-4 list-disc space-y-2">
              <li>{t("privacy.retentionAudit")}</li>
              <li>{t("privacy.retentionEmail")}</li>
              <li>{t("privacy.retentionNotifications")}</li>
              <li>{t("privacy.retentionBank")}</li>
              <li>{t("privacy.retentionConsents")}</li>
            </ul>
            <p>{t("privacy.retentionAccount")}</p>
          </Section>

          <Section title={t("privacy.rightsTitle")}>
            <p>{t("privacy.rightsIntro")}</p>
            <ul className="ml-4 list-disc space-y-2">
              <li>{t("privacy.rights1")}</li>
              <li>{t("privacy.rights2")}</li>
              <li>{t("privacy.rights3")}</li>
              <li>{t("privacy.rights4")}</li>
              <li>{t("privacy.rights5")}</li>
              <li>{t("privacy.rights6")}</li>
            </ul>
            <p className="text-sm text-zinc-500">{t("privacy.rightsExportNote")}</p>
          </Section>

          <Section title={t("privacy.cookiesTitle")}>
            <p>{t("privacy.cookiesBody")}</p>
          </Section>

          <Section title={t("privacy.processorsTitle")}>
            <p>{t("privacy.processorsIntro")}</p>
            <ul className="ml-4 list-disc space-y-2">
              <Term label={t("privacy.processorEnableBanking")}>
                {t("privacy.processorEnableBankingBody")}
              </Term>
              <Term label={t("privacy.processorStripe")}>{t("privacy.processorStripeBody")}</Term>
              <Term label={t("privacy.processorSendgrid")}>
                {t("privacy.processorSendgridBody")}
              </Term>
              <Term label={t("privacy.processorTax")}>{t("privacy.processorTaxBody")}</Term>
            </ul>
          </Section>

          <Section title={t("privacy.contactTitle")}>
            <p>
              {t("privacy.contactBody")}{" "}
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
