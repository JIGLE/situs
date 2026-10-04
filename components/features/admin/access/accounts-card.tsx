"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useToast } from "@/lib/contexts/toast-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import type { AccountSummary } from "@/lib/services/auth/accounts";
import type { InvitedRole } from "@/lib/services/auth/sign-up";
import { ACCESS_ROLE_KEY, ASSIGNABLE_ROLES, assignableRole } from "@/lib/utils/access-labels";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { formatDate } from "@/lib/utils/format-date";

interface Props {
  accounts: AccountSummary[];
  /** Read what is stored again. Resolves once the screen shows it. */
  onChanged: () => Promise<void>;
}

/**
 * The accounts on this instance, and the role of each. A role is all that changes here: nothing is
 * blocked and nothing is deleted.
 *
 * The instance keeps an administrator, and the server decides that, at the moment of the change
 * (409 `last_admin`): this list says why in words and shows the role the account still holds,
 * never the one that was picked. Giving up one's own administrator role asks first and then leaves
 * Admin, since the next request of an account that is no longer an administrator is refused.
 */
export function AccountsCard({ accounts, onChanged }: Props) {
  const t = useTranslations("admin.access.accounts");
  const tAccess = useTranslations("admin.access");
  const tActions = useTranslations("actions");
  const locale = useLocale();
  const router = useRouter();
  const apiError = useApiError();
  const toast = useToast();
  const { token: csrfToken } = useCsrf();
  const confirmDialog = useConfirmDialog();
  const [busy, setBusy] = useState<string | null>(null);

  async function change(account: AccountSummary, role: InvitedRole) {
    setBusy(account.id);
    let gaveUpAdmin = false;
    try {
      await apiFetch(`/api/admin/access/accounts/${account.id}`, csrfToken, "PUT", { role });
      toast.success(t("changed"));
      gaveUpAdmin = account.self && role !== "ADMIN";
    } catch (err) {
      toast.error(apiError(err));
    }
    if (gaveUpAdmin) {
      router.push("/dashboard");
      return;
    }
    await onChanged();
    setBusy(null);
  }

  function pick(account: AccountSummary, value: string) {
    const role = assignableRole(value);
    if (!role) return;
    if (account.self && account.role === "ADMIN") {
      confirmDialog.confirm(
        {
          title: t("demoteSelfTitle"),
          description: t("demoteSelfDescription"),
          confirmLabel: t("demoteSelfConfirm"),
          cancelLabel: tActions("cancel"),
        },
        () => change(account, role),
      );
      return;
    }
    void change(account, role);
  }

  return (
    <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3">
      <h2 className="text-sm font-medium text-[var(--color-foreground)]">{t("title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("help")}</p>
      <ul className="mt-3 divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
        {accounts.map((account) => {
          // A name that is empty is no name: the account is then known by its email.
          const name = account.name?.trim() || null;
          return (
            <li
              key={account.id}
              className="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-[var(--color-foreground)]">
                  <span className="break-all">{name ?? account.email}</span>
                  {account.self && (
                    <span className="rounded-full bg-[var(--color-hover)] px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {t("you")}
                    </span>
                  )}
                </p>
                {name && <p className="break-all text-xs text-muted-foreground">{account.email}</p>}
                <p className="text-xs text-muted-foreground">
                  {t("since", { date: formatDate(account.createdAt, locale) })}
                </p>
              </div>
              <div className="md:w-48 md:shrink-0">
                <Select
                  value={account.role}
                  onValueChange={(value) => pick(account, value)}
                  disabled={busy === account.id}
                >
                  <SelectTrigger aria-label={t("roleLabel", { email: account.email })}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* An account that holds no role a screen can give still names the one it holds. */}
                    {account.role === "USER" && (
                      <SelectItem value="USER" disabled>
                        {tAccess(ACCESS_ROLE_KEY.USER)}
                      </SelectItem>
                    )}
                    {ASSIGNABLE_ROLES.map((assignable) => (
                      <SelectItem key={assignable} value={assignable}>
                        {tAccess(ACCESS_ROLE_KEY[assignable])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmationDialog dialog={confirmDialog} />
    </section>
  );
}
