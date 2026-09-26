"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Minus } from "lucide-react";

import { apiFetch } from "@/lib/utils/api-client";
import type { SignInStatus } from "@/lib/services/admin/sign-in-status";

/**
 * How anyone can get into this instance.
 *
 * Reports, never switches. A toggle that disabled the provider you are signed in with would lock
 * you out with no way back through the UI, and auth policy stored in the database puts the sign-in
 * path behind the thing it must read to let you in. Provider configuration stays in the
 * environment, where a restart undoes a mistake.
 *
 * Everything shown is derived from environment presence and row counts — the `bankCheck` rule: a
 * page that asserts a fact about what exists becomes a lie the moment that stops being true.
 */
export function AdminSignInView() {
  const t = useTranslations("admin.signIn");
  const [status, setStatus] = useState<SignInStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        // Same double-unwrap as the accounts list had: `apiFetch` returns the envelope's
        // `data` already, so `body.data` was always undefined and this page rendered its
        // "could not load" state on every visit, whatever the server actually answered.
        const body = await apiFetch<SignInStatus>("/api/admin/sign-in-status");
        setStatus(body ?? null);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (error || !status) {
    return (
      <p
        role="alert"
        className="rounded-md bg-[var(--semantic-danger-soft)] px-3 py-2 text-sm text-[var(--semantic-danger-readable)]"
      >
        {t("loadFailed")}
      </p>
    );
  }

  const open = status.registration === "open_bootstrap";

  return (
    <div className="space-y-5">
      {/* No heading of its own: the page's heading and the Sign-in tab say what this is. */}
      <p className="text-sm text-muted-foreground">{t("subtitle")}</p>

      <section
        className={
          open
            ? "rounded-md border-l-2 border-[var(--semantic-warning-readable)] bg-[var(--semantic-warning-soft)] px-3 py-3"
            : "rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3"
        }
      >
        <p className="text-sm font-medium text-[var(--color-foreground)]">
          {open ? t("registrationOpen") : t("registrationClosed")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {open ? t("registrationOpenHelp") : t("registrationClosedHelp")}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("accounts", { total: status.totalAccounts, admins: status.adminAccounts })}
        </p>
      </section>

      <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3">
        <h2 className="text-sm font-medium text-[var(--color-foreground)]">{t("providers")}</h2>
        <ul className="mt-2 space-y-1.5">
          {status.providers.map((provider) => (
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
        {status.allowlist.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t("allowlistEmpty")}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {status.allowlist.map((email) => (
              <li key={email} className="font-mono text-sm text-[var(--color-foreground)]">
                {email}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-muted-foreground">{t("allowlistHelp")}</p>
      </section>
    </div>
  );
}

export default AdminSignInView;
