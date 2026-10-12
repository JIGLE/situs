"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useToast } from "@/lib/contexts/toast-context";
import { formatDate } from "@/lib/utils/format-date";
import { PasskeyError, addPasskey, type PasskeyProblem } from "@/lib/utils/passkey-client";
import type { PasskeySummary } from "@/lib/services/auth/passkey";

type Problem =
  "Cancelled" | "Unsupported" | "Invalid" | "Duplicate" | "Limit" | "TooMany" | "Generic";

const problemOf = (problem: PasskeyProblem): Problem =>
  problem === "cancelled"
    ? "Cancelled"
    : problem === "unsupported"
      ? "Unsupported"
      : problem === "invalid"
        ? "Invalid"
        : problem === "duplicate"
          ? "Duplicate"
          : problem === "limit"
            ? "Limit"
            : problem === "tooMany"
              ? "TooMany"
              : "Generic";

/**
 * The passkeys on the account, inside Settings › Security › Two-factor authentication.
 *
 * Shown only while the authenticator app is on: a passkey is a quicker way past that factor, not a
 * factor of its own, and the app is what an owner falls back to. Adding and removing one takes a code
 * from the app (the server checks), because a session someone else holds must not be able to add a
 * way in that outlives it. What is listed is a name and two dates, never the credential.
 */
export function PasskeysPanel() {
  const t = useTranslations("settings.panel");
  const tActions = useTranslations("actions");
  const locale = useLocale();
  const { token: csrfToken } = useCsrf();
  const { success, error: showError } = useToast();

  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  /** The form that is open: adding, or removing the passkey with this id. */
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PasskeySummary | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/passkey");
      if (!res.ok) return;
      const body = (await res.json()) as { passkeys?: PasskeySummary[] };
      setPasskeys(body.passkeys ?? []);
    } catch {
      // The list is a convenience: the panel still offers to add one.
      setPasskeys((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const close = () => {
    setAdding(false);
    setRemoving(null);
    setName("");
    setCode("");
  };

  const add = async () => {
    setWorking(true);
    try {
      await addPasskey({ code: code.replace(/\s/g, ""), name, csrfToken });
      success(t("passkeyToastAdded"));
      close();
      await load();
    } catch (err) {
      const problem = err instanceof PasskeyError ? problemOf(err.problem) : "Generic";
      showError(t(`passkeyErr${problem}`));
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setWorking(true);
    try {
      const res = await fetch(`/api/auth/passkey/${encodeURIComponent(removing.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken || "" },
        body: JSON.stringify({ code: code.replace(/\s/g, "") }),
      });
      if (res.status === 400) {
        showError(t("passkeyErrInvalid"));
        return;
      }
      if (res.status === 429) {
        showError(t("passkeyErrTooMany"));
        return;
      }
      if (!res.ok) {
        showError(t("passkeyRemoveFailed"));
        return;
      }
      success(t("passkeyToastRemoved"));
      close();
      await load();
    } catch {
      showError(t("passkeyRemoveFailed"));
    } finally {
      setWorking(false);
    }
  };

  if (passkeys === null) return null;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div>
        <p className="flex items-center gap-2 text-sm font-medium">
          <Fingerprint className="h-4 w-4" aria-hidden />
          {t("passkeysTitle")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t("passkeysDescription")}</p>
      </div>

      {passkeys.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("passkeysNone")}</p>
      ) : (
        <ul data-testid="passkey-list" className="divide-y divide-border border border-border">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {passkey.name}
                  {passkey.synced && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {t("passkeySynced")}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("passkeyAdded", { date: formatDate(passkey.createdAt, locale) })} ·{" "}
                  {passkey.lastUsedAt
                    ? t("passkeyUsed", { date: formatDate(passkey.lastUsedAt, locale) })
                    : t("passkeyNeverUsed")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={working}
                onClick={() => {
                  setAdding(false);
                  setCode("");
                  setRemoving(passkey);
                }}
              >
                {t("passkeyRemove")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {removing && (
        <div className="space-y-2">
          <Label htmlFor="passkey-remove-code">{t("verificationCode")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("passkeyRemoveHint", { name: removing.name })}
          </p>
          <Input
            id="passkey-remove-code"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
            className="w-40 text-center tracking-widest text-lg"
          />
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={remove}
              disabled={working || code.length < 6}
            >
              {t("passkeyRemove")}
            </Button>
            <Button size="sm" variant="outline" onClick={close} disabled={working}>
              {tActions("cancel")}
            </Button>
          </div>
        </div>
      )}

      {adding ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("passkeyAddHint")}</p>
          <div className="space-y-1">
            <Label htmlFor="passkey-name">{t("passkeyNameLabel")}</Label>
            <Input
              id="passkey-name"
              type="text"
              maxLength={60}
              placeholder={t("passkeyNamePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="max-w-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="passkey-code">{t("verificationCode")}</Label>
            <Input
              id="passkey-code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
              className="w-40 text-center tracking-widest text-lg"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              data-testid="passkey-save"
              onClick={add}
              disabled={working || code.length < 6}
            >
              {working ? t("passkeySaving") : t("passkeySave")}
            </Button>
            <Button size="sm" variant="outline" onClick={close} disabled={working}>
              {tActions("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        !removing && (
          <Button
            size="sm"
            variant="outline"
            data-testid="passkey-add"
            onClick={() => {
              setCode("");
              setAdding(true);
            }}
          >
            {t("passkeyAdd")}
          </Button>
        )
      )}
    </div>
  );
}
