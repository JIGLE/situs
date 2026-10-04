"use client";

import { useTranslations } from "next-intl";
import { Check, Minus } from "lucide-react";

import type { SignInStatus } from "@/lib/services/admin/sign-in-status";

interface Props {
  providers: SignInStatus["providers"];
  allowlist: string[];
}

/**
 * How a person can sign in, and the emails `AUTH_ALLOWED_EMAILS` admits in addition: both read-only.
 *
 * Providers are reported, never switched. A switch that disabled the method you are signed in with
 * would lock you out with no way back through the screen, and sign-in policy stored in the database
 * puts the sign-in path behind the thing it must read to let you in. The allowlist is the
 * operator's own configuration, and needs no database to admit them. Both stay in the environment,
 * where a restart undoes a mistake (see `lib/services/admin/sign-in-status.ts`).
 *
 * Everything shown is derived from environment presence, never asserted.
 */
export function SignInMethodsCard({ providers, allowlist }: Props) {
  const t = useTranslations("admin.signIn");

  return (
    <>
      <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3">
        <h2 className="text-sm font-medium text-[var(--color-foreground)]">{t("providers")}</h2>
        <ul className="mt-2 space-y-1.5">
          {providers.map((provider) => (
            <li key={provider.key} className="flex items-center gap-2 text-sm">
              {provider.configured ? (
                <Check
                  className="size-4 shrink-0 text-[var(--semantic-success-readable)]"
                  aria-hidden
                />
              ) : (
                <Minus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="text-[var(--color-foreground)]">
                {t(`provider.${provider.key}`)}
              </span>
              <span className="text-muted-foreground">
                {provider.configured ? t("configured") : t("notConfigured")}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">{t("providersHelp")}</p>
      </section>

      <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3">
        <h2 className="text-sm font-medium text-[var(--color-foreground)]">{t("allowlist")}</h2>
        {allowlist.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t("allowlistEmpty")}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {allowlist.map((email) => (
              <li
                key={email}
                className="break-all font-mono text-sm text-[var(--color-foreground)]"
              >
                {email}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-muted-foreground">{t("allowlistHelp")}</p>
      </section>
    </>
  );
}
