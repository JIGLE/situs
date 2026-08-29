"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { httpError, useApiError } from "@/lib/utils/api-error";
import { formatDateTime } from "@/lib/utils/format-date";
import { History } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/**
 * Situs AuditTrail — a reusable panel over AuditLog (resourceType/resourceId
 * persisted since Migration A). Pass `resourceIds` to scope to specific
 * records (property detail); omit it for the account-wide trail (Account
 * page). Same shape either way — one API, one component.
 */

interface AuditEntry {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: string;
}

export interface AuditTrailProps {
  /** Scope to these record ids; omit for the account-wide trail. */
  resourceIds?: string[];
  emptyTitle?: string;
  emptyDescription?: string;
}

export function AuditTrail({
  resourceIds,
  emptyTitle,
  emptyDescription,
}: AuditTrailProps): React.ReactElement {
  const apiError = useApiError();
  const t = useTranslations("common");
  const locale = useLocale();
  // Defaults resolve here, not in the parameter list, because `t` does not exist yet up there.
  // They used to be English string literals, so any caller that did not pass its own copy — the
  // Account page among them — printed "Audit trail" into a fully translated screen.
  const resolvedEmptyTitle = emptyTitle ?? t("auditTrail");
  const resolvedEmptyDescription = emptyDescription ?? t("auditTrailEmpty");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resourceIds && resourceIds.length === 0) {
      setEntries([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = resourceIds ? `?resourceIds=${resourceIds.join(",")}` : "";
    fetch(`/api/audit-trail${query}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw httpError(res.status);
        return res.json();
      })
      .then((body) => {
        if (!cancelled) setEntries(body?.data ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(apiError(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resourceIds array identity changes every render; join() is the real dep
  }, [resourceIds?.join(",")]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">
          {t("loading")}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-[var(--semantic-danger-readable)]">
          {error}
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      // An empty list should be a line, not a room. This was `py-14` around a framed icon and two
      // centred lines — roughly 250px of bordered panel to say that nothing has happened yet, and
      // once Settings was tightened it became the tallest thing on the Account page. The icon in
      // its own bordered square was the giveaway: a decorative glyph given the same treatment as
      // real content.
      //
      // The words stay, because they are doing work — `emptyDescription` says what *will* appear
      // here, which is the useful thing when there is no action for the reader to take.
      <Card>
        <CardContent className="flex items-start gap-3 py-4">
          <History
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]"
            aria-hidden="true"
          />
          <div className="min-w-0 space-y-1">
            <p className="mono-label">{resolvedEmptyTitle}</p>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {resolvedEmptyDescription}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <p className="mono-label">{t("auditTrail")}</p>
      </div>
      <div className="divide-y divide-[var(--color-border)]">
        {entries.map((entry) => (
          <div key={entry.id} className="px-4 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.04em]">
                {entry.action.replace(/_/g, " ")}
              </span>
              <span className="tabular-nums text-xs text-[var(--color-muted-foreground)]">
                {formatDateTime(entry.createdAt, locale)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
