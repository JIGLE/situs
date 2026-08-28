"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/utils/format-date";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiFetch } from "@/lib/utils/api-client";
import { useCsrf } from "@/lib/contexts/csrf-context";

interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  isSelf: boolean;
  owns: { properties: number; tenants: number; leases: number; receipts: number };
}

/**
 * Every account on the instance, and the only way to revoke one.
 *
 * This page exists because closing registration could not answer "who is already in?". During the
 * window when the OAuth callback admitted anyone, a stranger signing in became an ADMIN — and the
 * shape that reveals is visible here at a glance: an administrator who owns nothing.
 *
 * The confirmation names what will be destroyed rather than asking whether you are sure. Deleting
 * a `User` cascades to their properties, tenants, leases and receipts, and "are you sure?" is not
 * informed consent when the answer erases a ledger.
 */
export function AdminUsersView() {
  const t = useTranslations("admin.users");
  const locale = useLocale();
  const { token: csrfToken } = useCsrf();

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<AdminUserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // `apiFetch` already unwraps the envelope's `data` field, so reading `.data` again here
      // always yielded `undefined` and the list rendered empty on every load — this page had
      // never shown a single account. The generic said `{ data?: ... }`, so it type-checked.
      const body = await apiFetch<{ users?: AdminUserRow[] }>("/api/admin/users");
      setUsers(body?.users ?? []);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmDelete() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${pending.id}`, csrfToken, "DELETE");
      setPending(null);
      await load();
    } catch (err) {
      // The server's refusals are specific — "you cannot delete your own account", "this is the
      // only administrator" — and each names a different remedy, so the message is surfaced
      // rather than replaced with a generic failure.
      const message = (err as { message?: string })?.message;
      setError(message || t("deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  const total = (row: AdminUserRow) =>
    row.owns.properties + row.owns.tenants + row.owns.leases + row.owns.receipts;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-foreground)]">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-[var(--semantic-danger-soft)] px-3 py-2 text-sm text-[var(--semantic-danger-readable)]"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : users.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--color-foreground)]">
                  {user.email}
                  {user.isSelf ? (
                    <span className="ml-2 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs font-normal text-muted-foreground">
                      {t("you")}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {user.role} · {t("joined", { date: formatDate(user.createdAt, locale) })} ·{" "}
                  {t("owns", { count: total(user) })}
                </p>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => setPending(user)}
                disabled={user.isSelf}
                // Disabled rather than hidden: the row still has to show that the account exists,
                // and why this particular one cannot be removed here.
                title={user.isSelf ? t("cannotDeleteSelf") : undefined}
              >
                <Trash2 className="mr-1.5 size-3.5" aria-hidden />
                {t("remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert
                className="size-4 text-[var(--semantic-danger-readable)]"
                aria-hidden
              />
              {t("confirmTitle", { email: pending?.email ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>{t("confirmBody")}</p>
                {pending && total(pending) > 0 ? (
                  <ul className="list-disc space-y-0.5 pl-5">
                    <li>{t("countProperties", { count: pending.owns.properties })}</li>
                    <li>{t("countTenants", { count: pending.owns.tenants })}</li>
                    <li>{t("countLeases", { count: pending.owns.leases })}</li>
                    <li>{t("countReceipts", { count: pending.owns.receipts })}</li>
                  </ul>
                ) : (
                  <p>{t("ownsNothing")}</p>
                )}
                <p className="font-medium text-[var(--semantic-danger-readable)]">
                  {t("irreversible")}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              disabled={busy}
            >
              {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden /> : null}
              {t("confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default AdminUsersView;
