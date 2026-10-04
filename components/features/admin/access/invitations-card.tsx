"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useToast } from "@/lib/contexts/toast-context";
import type { InvitationSummary, InvitedRole } from "@/lib/services/auth/sign-up";
import { ACCESS_ROLE_KEY, ASSIGNABLE_ROLES, assignableRole } from "@/lib/utils/access-labels";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { formatDate } from "@/lib/utils/format-date";

interface Props {
  invitations: InvitationSummary[];
  /** Whether the invitations switch is on: switched off, none of these admits anyone. */
  switchedOn: boolean;
  /** Read what is stored again. Resolves once the screen shows it. */
  onChanged: () => Promise<void>;
}

/**
 * The invitations still held: an email and the role it was invited as, until it lapses.
 *
 * An invitation is an allowlist entry that expires, not another way to sign in: the person still
 * signs in with Google, and the invitation is used up by the account it makes. Inviting an email
 * that is already invited renews it, so the form needs no "already sent" case, and one that already
 * has an account is refused in words that point to the Accounts list.
 */
export function InvitationsCard({ invitations, switchedOn, onChanged }: Props) {
  const t = useTranslations("admin.access.invitations");
  const tAccess = useTranslations("admin.access");
  const locale = useLocale();
  const apiError = useApiError();
  const toast = useToast();
  const { token: csrfToken } = useCsrf();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitedRole>("MANAGER");
  const [sending, setSending] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    try {
      await apiFetch("/api/admin/access/invitations", csrfToken, "POST", { email, role });
      toast.success(t("invited"));
      setEmail("");
    } catch (err) {
      toast.error(apiError(err));
    }
    await onChanged();
    setSending(false);
  }

  async function remove(invitation: InvitationSummary) {
    setRemoving(invitation.id);
    try {
      await apiFetch(`/api/admin/access/invitations/${invitation.id}`, csrfToken, "DELETE");
      toast.success(t("removed"));
    } catch (err) {
      toast.error(apiError(err));
    }
    await onChanged();
    setRemoving(null);
  }

  return (
    <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3">
      <h2 className="text-sm font-medium text-[var(--color-foreground)]">{t("title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("help")}</p>
      {!switchedOn && (
        <p className="mt-2 rounded-md bg-[var(--semantic-warning-soft)] px-3 py-2 text-sm text-[var(--semantic-warning-readable)]">
          {t("off")}
        </p>
      )}

      {/* `noValidate`: the browser's own "enter an email" bubble is in the browser's language. */}
      <form
        onSubmit={invite}
        noValidate
        className="mt-3 flex flex-col gap-3 md:flex-row md:items-end"
      >
        {/* `gap`, not `space-y`: inside a form the select brings a hidden native one after it, which
            would make the trigger "not the last child" and push its column's bottom edge 6px down. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="invitation-email">{t("email")}</Label>
          {/* `type="email"` strips the spaces around what is typed, so `email` is what is sent. */}
          <Input
            id="invitation-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5 md:w-48">
          <Label htmlFor="invitation-role">{t("role")}</Label>
          <Select value={role} onValueChange={(value) => setRole(assignableRole(value) ?? role)}>
            <SelectTrigger id="invitation-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSIGNABLE_ROLES.map((assignable) => (
                <SelectItem key={assignable} value={assignable}>
                  {tAccess(ACCESS_ROLE_KEY[assignable])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={sending || email === ""}>
          {t("invite")}
        </Button>
      </form>

      {invitations.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <p className="break-all text-sm font-medium text-[var(--color-foreground)]">
                  {invitation.email}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tAccess(ACCESS_ROLE_KEY[invitation.role])}
                  {" · "}
                  {invitation.expired ? (
                    <span className="text-[var(--semantic-warning-readable)]">{t("expired")}</span>
                  ) : (
                    t("expires", { date: formatDate(invitation.expiresAt, locale) })
                  )}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 self-start md:self-auto"
                disabled={removing === invitation.id}
                aria-label={t("removeLabel", { email: invitation.email })}
                onClick={() => void remove(invitation)}
              >
                {t("remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
