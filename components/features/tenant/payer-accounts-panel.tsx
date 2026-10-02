"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useToast } from "@/lib/contexts/toast-context";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { formatDate } from "@/lib/utils/format-date";

interface PayerAccountRow {
  id: string;
  ibanLast4: string | null;
  holderName: string | null;
  createdAt: string;
}

interface Props {
  tenantId: string;
  tenantName: string;
}

/**
 * The accounts the owner confirmed pay this tenant's rent, and **Esquecer** for each. A payment from
 * one of them for the same amount as the rent is matched to the tenant on its own, so the owner can
 * see what that rests on and take it back: the payments then wait for them again.
 *
 * Nothing is drawn while there is nothing remembered: there is nothing to manage.
 */
export function PayerAccountsPanel({ tenantId, tenantName }: Props) {
  const t = useTranslations("tenants.payerAccounts");
  const locale = useLocale();
  const apiError = useApiError();
  const toast = useToast();
  const { token: csrfToken } = useCsrf();
  const [accounts, setAccounts] = useState<PayerAccountRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await apiFetch<PayerAccountRow[]>(`/api/tenants/${tenantId}/payer-accounts`));
      setError(null);
    } catch (err) {
      setAccounts([]);
      setError(apiError(err));
    }
  }, [tenantId, apiError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function forget(account: PayerAccountRow) {
    setForgetting(account.id);
    try {
      await apiFetch(`/api/tenants/${tenantId}/payer-accounts/${account.id}`, csrfToken, "DELETE");
      toast.success(t("forgotten"));
      await load();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setForgetting(null);
    }
  }

  if (error) {
    return (
      <p role="alert" className="mt-4 text-sm text-[var(--semantic-danger-readable)]">
        {error}
      </p>
    );
  }
  if (accounts.length === 0) return null;

  return (
    <section className="mt-4 space-y-2">
      <h3 className="text-sm font-medium text-[var(--color-foreground)]">{t("title")}</h3>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        {t("description", { tenant: tenantName })}
      </p>
      <ul className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] bg-[var(--color-card)]">
        {accounts.map((account) => {
          const name = [
            account.holderName,
            account.ibanLast4 ? t("ending", { last4: account.ibanLast4 }) : t("account"),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={account.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-[var(--color-foreground)]">
                  {name}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {t("since", { date: formatDate(account.createdAt, locale) })}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={forgetting === account.id}
                aria-label={t("forgetAccount", { account: name })}
                onClick={() => void forget(account)}
              >
                {t("forget")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
