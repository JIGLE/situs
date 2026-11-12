"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { Panel } from "@/components/shared/panel";
import { AuditTrail } from "@/components/shared/audit-trail";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/contexts/toast-context";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { cn } from "@/lib/utils/utils";

/**
 * Settings › My data: what the account holds, to take away, to read back, or to delete.
 *
 * The GDPR export and the account deletion sat under Security beside the authenticator app, and the
 * account's activity under Account beside the tax country. They are one subject, the owner's own
 * data, so they are one section.
 *
 * The activity starts closed and is fetched only when opened: it is a record to consult.
 */
export function SettingsData() {
  const { error: showError } = useToast();
  const { token: csrfToken } = useCsrf();
  const t = useTranslations("settings.panel");
  const apiError = useApiError();
  const confirmDialog = useConfirmDialog();
  const [activityOpen, setActivityOpen] = useState(false);

  const exportData = async () => {
    try {
      const res = await fetch("/api/user/export-data", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken || "" },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "situs-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showError(t("exportFailed"));
    }
  };

  /** Was a native `window.confirm`, which cannot be translated and is the one pattern the
   *  rest of the app routes through ConfirmationDialog instead. */
  const requestDelete = () => {
    confirmDialog.confirm(
      {
        title: t("deleteConfirmTitle"),
        description: t("deleteConfirmDescription"),
        confirmLabel: t("deleteConfirmLabel"),
        variant: "destructive",
      },
      async () => {
        try {
          await apiFetch("/api/user/delete-data", csrfToken, "POST");
          // The session's token outlives the account for up to a day, and the sign-in page sends a
          // visitor who still has one on to the dashboard: end the session before leaving.
          await signOut({ callbackUrl: "/auth/signin" });
        } catch (err) {
          // The only administrator is told why, in words: "the instance needs an administrator".
          showError(apiError(err));
        }
      },
    );
  };

  return (
    <div className="space-y-6">
      <Panel title={t("dataRights")} description={t("dataRightsDescription")} padded>
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("exportTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("exportHelp")}</p>
          <Button variant="outline" size="sm" onClick={exportData}>
            {t("exportTitle")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("retention")}</p>
      </Panel>

      <Panel tone="danger" title={t("deleteTitle")} description={t("deleteHelp")} padded>
        <Button variant="destructive" size="sm" onClick={requestDelete}>
          {t("deleteTitle")}
        </Button>
      </Panel>

      <div className="space-y-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={activityOpen}
          onClick={() => setActivityOpen((open) => !open)}
          className="-ml-3 gap-1.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <ChevronRight
            aria-hidden
            className={cn("h-4 w-4 transition-transform", activityOpen && "rotate-90")}
          />
          {t("activity")}
        </Button>
        {activityOpen && <AuditTrail emptyDescription={t("activityEmpty")} />}
      </div>

      <ConfirmationDialog dialog={confirmDialog} />
    </div>
  );
}

export default SettingsData;
