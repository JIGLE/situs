"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import type { SignInStatus } from "@/lib/services/admin/sign-in-status";
import type { AccountSummary } from "@/lib/services/auth/accounts";
import type { InvitationSummary, SignUpSettings } from "@/lib/services/auth/sign-up";
import { apiFetch } from "@/lib/utils/api-client";
import { AccountsCard } from "./accounts-card";
import { InvitationsCard } from "./invitations-card";
import { NewAccountsCard } from "./new-accounts-card";
import { RegistrationCard } from "./registration-card";
import { SignInMethodsCard } from "./sign-in-methods-card";

/** What `GET /api/admin/access` serves. */
interface AccessData {
  settings: SignUpSettings;
  invitations: InvitationSummary[];
  allowlist: string[];
  accounts: AccountSummary[];
}

/**
 * Admin › Acessos: who may create an account, who has one, and what each may do.
 *
 * No heading of its own: the page's heading and the Acessos tab say what this is. Everything on it
 * is read from the server and read again after every change, so what is drawn is what is stored,
 * and the sentence at the top (the registration state) follows the switches below it.
 *
 * The first block is derived, from the account count, the switches and the invitations still live;
 * the three after it change something (the switches, the invitations, an account's role); the last
 * two only report, and stay in the environment for the reason `SignInMethodsCard` gives.
 */
export function AdminAccessView() {
  const t = useTranslations("admin.access");
  const [access, setAccess] = useState<AccessData | null>(null);
  const [status, setStatus] = useState<SignInStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      // `apiFetch` returns the envelope's `data` already: reading `.data` off these is undefined.
      const [accessData, statusData] = await Promise.all([
        apiFetch<AccessData>("/api/admin/access"),
        apiFetch<SignInStatus>("/api/admin/sign-in-status"),
      ]);
      setAccess(accessData ?? null);
      setStatus(statusData ?? null);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (failed || !access || !status) {
    return (
      <p
        role="alert"
        className="rounded-md bg-[var(--semantic-danger-soft)] px-3 py-2 text-sm text-[var(--semantic-danger-readable)]"
      >
        {t("loadFailed")}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      <RegistrationCard status={status} />
      <NewAccountsCard settings={access.settings} onChanged={load} />
      <InvitationsCard
        invitations={access.invitations}
        switchedOn={access.settings.invitations}
        onChanged={load}
      />
      <AccountsCard accounts={access.accounts} onChanged={load} />
      <SignInMethodsCard providers={status.providers} allowlist={access.allowlist} />
    </div>
  );
}

export default AdminAccessView;
