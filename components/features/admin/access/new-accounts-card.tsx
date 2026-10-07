"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useToast } from "@/lib/contexts/toast-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import type { SignUpSettings } from "@/lib/services/auth/sign-up";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { cn } from "@/lib/utils/utils";

interface Props {
  settings: SignUpSettings;
  /** Read what is stored again. Resolves once the screen shows it. */
  onChanged: () => Promise<void>;
}

/**
 * Who may create an account they do not have yet: the two switches.
 *
 * They govern new accounts and nothing else, which the card says before it says anything about
 * either: whoever already has an account signs in whatever is set here. A switch shows what the
 * server stored, never what was just clicked, so a refused change leaves it where it was and a
 * change that went through is read back before the screen believes it.
 *
 * Opening Google sign-up is the one change that asks first, because of what it lets in: any Google
 * account with a verified email becomes a manager, with every owner feature on its own data, the
 * bank connection included. Closing it, or either change to invitations, is cheap to undo.
 */
export function NewAccountsCard({ settings, onChanged }: Props) {
  const t = useTranslations("admin.access.newAccounts");
  const tActions = useTranslations("actions");
  const apiError = useApiError();
  const toast = useToast();
  const { token: csrfToken } = useCsrf();
  const confirmDialog = useConfirmDialog();
  const [busy, setBusy] = useState<keyof SignUpSettings | null>(null);

  async function save(key: keyof SignUpSettings, value: boolean) {
    setBusy(key);
    try {
      await apiFetch("/api/admin/access/settings", csrfToken, "PUT", { [key]: value });
      toast.success(t("saved"));
    } catch (err) {
      toast.error(apiError(err));
    }
    // Either way: the switch shows what the server holds.
    await onChanged();
    setBusy(null);
  }

  function toggle(key: keyof SignUpSettings) {
    const next = !settings[key];
    if (key === "googleSignUp" && next) {
      confirmDialog.confirm(
        {
          title: t("openGoogleTitle"),
          description: t("openGoogleDescription"),
          confirmLabel: t("openGoogleConfirm"),
          cancelLabel: tActions("cancel"),
        },
        () => save(key, next),
      );
      return;
    }
    void save(key, next);
  }

  return (
    <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3">
      <h2 className="text-sm font-medium text-[var(--color-foreground)]">{t("title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("help")}</p>
      <div className="mt-2 divide-y divide-[var(--color-border)]">
        <SwitchRow
          id="access-invitations"
          label={t("invitations")}
          help={t("invitationsHelp")}
          checked={settings.invitations}
          busy={busy === "invitations"}
          onToggle={() => toggle("invitations")}
        />
        <SwitchRow
          id="access-google"
          label={t("googleSignUp")}
          help={t("googleSignUpHelp")}
          checked={settings.googleSignUp}
          busy={busy === "googleSignUp"}
          onToggle={() => toggle("googleSignUp")}
        />
      </div>
      <ConfirmationDialog dialog={confirmDialog} />
    </section>
  );
}

/**
 * A switch that is the whole row. The track alone is 24px tall, below the 44px a thumb needs, so
 * the row is the button and the track only shows its state. The name is the label and the help is
 * the description, whatever order the text is laid out in.
 */
function SwitchRow({
  id,
  label,
  help,
  checked,
  busy,
  onToggle,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-help`}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={onToggle}
      className="flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-[var(--color-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--country-highlight-readable)] disabled:cursor-wait disabled:opacity-60 max-md:min-h-11"
    >
      <span className="min-w-0 flex-1">
        <span
          id={`${id}-label`}
          className="block text-sm font-medium text-[var(--color-foreground)]"
        >
          {label}
        </span>
        <span id={`${id}-help`} className="mt-1 block text-sm text-muted-foreground">
          {help}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cn(
            "block h-5 w-5 rounded-full bg-background shadow-lg transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}
