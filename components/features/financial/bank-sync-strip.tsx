"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/contexts/toast-context";
import {
  BANK_SYNC_PROBLEM_KEY,
  useBankConnections,
  useBankSync,
  type BankConnectionRow,
} from "@/lib/hooks/use-bank-connections";
import { CONSENT_WARNING_DAYS, daysUntil } from "@/lib/utils/bank-inbox";
import { formatDate } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/utils";

const SETTINGS_INTEGRATIONS = "/settings?tab=integrations";

interface Props {
  /** Called after a sync that reached the bank, so the inbox and its counts reload. */
  onSynced: () => void;
}

/**
 * The live bank connections, above the inbox they feed: when each last synced, how long its
 * consent lasts, and **Sincronizar agora**. The inbox is where the owner waits for money, so
 * this is where they look for it. Setting a connection up stays in Settings.
 */
export function BankSyncStrip({ onSynced }: Props) {
  const t = useTranslations("financial.bank.sync");
  const tPanel = useTranslations("settings.panel");
  const locale = useLocale();
  const toast = useToast();
  const { connections, loading, reload } = useBankConnections();
  const syncNow = useBankSync();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Manual and file connections hold movements that arrived before, and there is nothing to
  // sync on them.
  const banks = connections.filter((c) => c.isProvider);

  if (loading) return null;

  // Settings is reached through a button, not a link in the sentence: an inline link is a tap
  // target one line of text tall, which on a phone is too small to hit.
  const toSettings = (label: string) => (
    <Button asChild size="sm" variant="outline">
      <Link href={SETTINGS_INTEGRATIONS}>{label}</Link>
    </Button>
  );

  if (banks.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("noBank")}</p>
        {toSettings(tPanel("bankConnectCta"))}
      </div>
    );
  }

  async function sync(connection: BankConnectionRow) {
    setBusyId(connection.id);
    const outcome = await syncNow(connection.id);
    setBusyId(null);
    reload();
    if (outcome.ok) {
      toast.success(t("done", { imported: outcome.imported }));
      onSynced();
    } else {
      toast.error(tPanel(BANK_SYNC_PROBLEM_KEY[outcome.problem]));
    }
  }

  function consentLine(c: BankConnectionRow) {
    if (!c.consentExpiresAt) return null;
    const date = formatDate(c.consentExpiresAt, locale);
    const days = daysUntil(c.consentExpiresAt);
    if (c.status === "expired" || days < 0) {
      return (
        <span className="text-[var(--semantic-danger-readable)]">
          {tPanel("bankConsentEnded", { date })}
        </span>
      );
    }
    return (
      <span
        className={cn(days <= CONSENT_WARNING_DAYS && "text-[var(--semantic-warning-readable)]")}
      >
        {days <= CONSENT_WARNING_DAYS
          ? tPanel("bankConsentEnding", { date })
          : tPanel("bankConsentUntil", { date })}
      </span>
    );
  }

  return (
    <ul className="divide-y divide-[var(--color-border)] border-b border-[var(--color-border)]">
      {banks.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium text-[var(--color-foreground)]">
              {c.institutionName}
            </p>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {tPanel("bankLastSync", {
                date: formatDate(c.lastSyncAt, locale, tPanel("bankNeverSynced")),
              })}
            </p>
            <p className="text-xs text-[var(--color-muted-foreground)]">{consentLine(c)}</p>
          </div>

          {c.status === "expired" ? (
            toSettings(t("reconnect"))
          ) : c.canSync ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void sync(c)}
                disabled={busyId === c.id || c.remainingBudget === 0}
              >
                {busyId === c.id ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                {tPanel("bankSyncNow")}
              </Button>
              {c.remainingBudget !== null ? (
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {tPanel("bankSyncsLeft", { count: c.remainingBudget })}
                </span>
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
