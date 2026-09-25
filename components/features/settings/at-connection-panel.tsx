"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

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
import { useConnectorMode } from "@/components/shared/connector-mode";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { AT_SELECTABLE_MODES } from "@/lib/schemas/at-connection.schema";
import type { AtCallView, AtConnectionView } from "@/lib/services/tax/at-connection";
import type { AtFileName, AtFileState } from "@/lib/tax/at/config";
import { AT_USERNAME } from "@/lib/tax/at/username";
import { TEST_MODES } from "@/lib/tax/connectors/modes";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { formatDate } from "@/lib/utils/format-date";

/**
 * Settings › Integrations: the owner's connection to AT. The instance's certificate files as the
 * server reads them, the Portal sub-user Situs signs in as, the connector's mode, and the two calls
 * that change nothing at AT: Check credentials and Fetch a receipt.
 *
 * The password field is write-only. The server never returns the password, so the field starts
 * empty and says whether one is stored; typing replaces it.
 */

const FILES: AtFileName[] = ["cert", "key", "authKey"];

/** A stored enum is not a label: each file state has its own key. */
const FILE_STATE_KEY = {
  ok: "fileState.ok",
  unset: "fileState.unset",
  unreadable: "fileState.unreadable",
  invalid: "fileState.invalid",
  encrypted: "fileState.encrypted",
} as const satisfies Record<AtFileState, string>;

const FILE_KEY = {
  cert: "file.cert",
  key: "file.key",
  authKey: "file.authKey",
} as const satisfies Record<AtFileName, string>;

const MODE_OPTION_KEY = {
  sandbox: "modeOption.sandbox",
  review: "modeOption.review",
  test: "modeOption.test",
} as const satisfies Record<(typeof AT_SELECTABLE_MODES)[number], string>;

/** Within this many days the certificate's line is shown as a warning, as the status page does. */
const RENEWAL_WARNING_DAYS = 30;

type Busy = "save" | "remove" | "mode" | "check" | "fetch" | null;
type Notice = { tone: "success" | "error"; text: string; atMessage?: string };

const TONE_CLASS: Record<Notice["tone"], string> = {
  success: "text-[var(--semantic-success-readable)]",
  error: "text-[var(--semantic-danger-readable)]",
};

function downloadPdf(base64: string, name: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function AtConnectionPanel() {
  const t = useTranslations("settings.at");
  const locale = useLocale();
  const apiError = useApiError();
  const connectorMode = useConnectorMode();
  const { token: csrfToken } = useCsrf();

  const [connection, setConnection] = useState<AtConnectionView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginNotice, setLoginNotice] = useState<Notice | null>(null);
  const [modeNotice, setModeNotice] = useState<Notice | null>(null);
  const [checkNotice, setCheckNotice] = useState<Notice | null>(null);
  const [fetchNotice, setFetchNotice] = useState<Notice | null>(null);
  const [contractNumber, setContractNumber] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");

  const load = useCallback(async () => {
    try {
      const view = await apiFetch<AtConnectionView>("/api/tax/connectors/at");
      setConnection(view);
      setUsername(view.username ?? "");
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** AT's answer in the owner's language, with AT's own words beside it when it sent some. */
  const describeCall = (call: AtCallView, purpose: "check" | "fetch"): Notice => {
    switch (call.outcome) {
      case "answer": {
        const atMessage = call.message || undefined;
        switch (call.category) {
          case "ok":
          case "rejected":
            // AT authenticates before it looks: −1 on a check means every credential was accepted.
            return purpose === "check"
              ? { tone: "success", text: t("result.accepted") }
              : { tone: "error", text: t("result.notFound"), atMessage };
          case "username":
            return { tone: "error", text: t("result.username"), atMessage };
          case "password":
            return { tone: "error", text: t("result.password"), atMessage };
          case "key":
            return { tone: "error", text: t("result.key"), atMessage };
          case "clock":
            return { tone: "error", text: t("result.clock"), atMessage };
          case "request":
            return { tone: "error", text: t("result.request"), atMessage };
          case "at_fault":
            return { tone: "error", text: t("result.atFault"), atMessage };
          case "unknown":
            return { tone: "error", text: t("result.otherCode", { code: call.code }), atMessage };
        }
        break;
      }
      case "fault":
        return { tone: "error", text: t("result.fault", { fault: call.faultString }) };
      case "not_sent":
        return { tone: "error", text: t("result.notSent") };
      case "unknown":
        return { tone: "error", text: t("result.noAnswer") };
    }
    return { tone: "error", text: t("result.noAnswer") };
  };

  const usernameValid = AT_USERNAME.test(username.trim());

  const saveLogin = async () => {
    setBusy("save");
    setLoginNotice(null);
    try {
      const view = await apiFetch<AtConnectionView>(
        "/api/tax/connectors/at/credentials",
        csrfToken,
        "PUT",
        { username: username.trim(), ...(password ? { password } : {}) },
      );
      setConnection(view);
      setPassword("");
      setLoginNotice({ tone: "success", text: t("saved") });
    } catch (error) {
      setLoginNotice({ tone: "error", text: apiError(error) });
    } finally {
      setBusy(null);
    }
  };

  const removeLogin = async () => {
    setBusy("remove");
    setLoginNotice(null);
    try {
      const view = await apiFetch<AtConnectionView>(
        "/api/tax/connectors/at/credentials",
        csrfToken,
        "DELETE",
      );
      setConnection(view);
      setUsername("");
      setPassword("");
    } catch (error) {
      setLoginNotice({ tone: "error", text: apiError(error) });
    } finally {
      setBusy(null);
    }
  };

  const changeMode = async (mode: string) => {
    setBusy("mode");
    setModeNotice(null);
    setCheckNotice(null);
    try {
      setConnection(
        await apiFetch<AtConnectionView>("/api/tax/connectors/at/mode", csrfToken, "PUT", {
          mode,
        }),
      );
    } catch (error) {
      setModeNotice({ tone: "error", text: apiError(error) });
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    setBusy("check");
    setCheckNotice(null);
    try {
      const call = await apiFetch<AtCallView>(
        "/api/tax/connectors/at/check",
        csrfToken,
        "POST",
        {},
      );
      setCheckNotice(describeCall(call, "check"));
    } catch (error) {
      setCheckNotice({ tone: "error", text: apiError(error) });
    } finally {
      setBusy(null);
    }
  };

  const fetchReceipt = async () => {
    setBusy("fetch");
    setFetchNotice(null);
    const contract = Number(contractNumber);
    const receipt = Number(receiptNumber);
    try {
      const result = await apiFetch<{ call: AtCallView; pdf?: string }>(
        "/api/tax/connectors/at/receipt",
        csrfToken,
        "POST",
        { contractNumber: contract, receiptNumber: receipt },
      );
      if (result.pdf) {
        downloadPdf(result.pdf, `recibo-${contract}-${receipt}.pdf`);
      } else {
        setFetchNotice(describeCall(result.call, "fetch"));
      }
    } catch (error) {
      setFetchNotice({ tone: "error", text: apiError(error) });
    } finally {
      setBusy(null);
    }
  };

  if (loadFailed) {
    return <p className="text-sm text-[var(--semantic-danger-readable)]">{t("loadFailed")}</p>;
  }
  if (!connection) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />;
  }

  const { files } = connection;
  const inTestMode = TEST_MODES.has(connection.mode);
  const certificate = files.certificate;
  const wholeNumber = (value: string) => /^\d+$/.test(value);

  return (
    <div className="space-y-6">
      <section className="space-y-2" aria-labelledby="at-files">
        <h3 id="at-files" className="text-sm font-medium">
          {t("filesTitle")}
        </h3>
        <ul className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {FILES.map((name) => {
            const file = files.files[name];
            return (
              <li key={name} className="flex flex-col gap-0.5 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">{t(FILE_KEY[name])}</span>
                  <span
                    className={`text-xs ${
                      file.state === "ok"
                        ? "text-muted-foreground"
                        : "text-[var(--semantic-danger-readable)]"
                    }`}
                  >
                    {t(FILE_STATE_KEY[file.state])}
                  </span>
                </div>
                {name === "cert" && certificate ? (
                  <p
                    className={`text-xs ${
                      certificate.daysLeft < 0
                        ? "text-[var(--semantic-danger-readable)]"
                        : certificate.daysLeft <= RENEWAL_WARNING_DAYS
                          ? "text-[var(--semantic-warning-readable)]"
                          : "text-muted-foreground"
                    }`}
                  >
                    {certificate.daysLeft < 0
                      ? t("certificateExpired", { date: formatDate(certificate.validTo, locale) })
                      : `${t("certificateFor", {
                          subject: certificate.subject,
                          date: formatDate(certificate.validTo, locale),
                        })} · ${t("daysLeft", { days: certificate.daysLeft })}`}
                  </p>
                ) : null}
                {name === "key" && files.keyMatches === false ? (
                  <p className="text-xs text-[var(--semantic-danger-readable)]">
                    {t("keyMismatch")}
                  </p>
                ) : null}
                {name === "authKey" && files.authKeyValidTo ? (
                  <p className="text-xs text-muted-foreground">
                    {t("validUntil", { date: formatDate(files.authKeyValidTo, locale) })}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">{t("filesHelp")}</p>
      </section>

      <section className="space-y-3" aria-labelledby="at-login">
        <div>
          <h3 id="at-login" className="text-sm font-medium">
            {t("loginTitle")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("loginHelp")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="at-username">{t("username")}</Label>
            <Input
              id="at-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="123456789/1"
              autoComplete="username"
              spellCheck={false}
              aria-invalid={username.trim() !== "" && !usernameValid}
              aria-describedby="at-username-help"
            />
            {username.trim() !== "" && !usernameValid ? (
              <p id="at-username-help" className="text-xs text-[var(--semantic-danger-readable)]">
                {t("usernameInvalid")}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="at-password">{t("password")}</Label>
            <Input
              id="at-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              aria-describedby="at-password-help"
            />
            {connection.passwordSet || connection.credentialsUnreadable ? (
              <p
                id="at-password-help"
                className={`text-xs ${
                  connection.credentialsUnreadable
                    ? "text-[var(--semantic-danger-readable)]"
                    : "text-muted-foreground"
                }`}
              >
                {connection.credentialsUnreadable ? t("passwordUnreadable") : t("passwordStored")}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={saveLogin}
            disabled={busy !== null || !usernameValid || (!password && !connection.passwordSet)}
            className="w-full sm:w-auto"
          >
            {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("save")}
          </Button>
          {connection.passwordSet || connection.credentialsUnreadable ? (
            <Button
              variant="outline"
              onClick={removeLogin}
              disabled={busy !== null}
              className="w-full sm:w-auto"
            >
              {t("remove")}
            </Button>
          ) : null}
        </div>
        {loginNotice ? (
          <p role="status" className={`text-sm ${TONE_CLASS[loginNotice.tone]}`}>
            {loginNotice.text}
          </p>
        ) : null}
      </section>

      <section className="space-y-2" aria-labelledby="at-mode">
        <h3 id="at-mode" className="text-sm font-medium">
          {t("modeTitle")}
        </h3>
        <Select value={connection.mode} onValueChange={changeMode} disabled={busy !== null}>
          <SelectTrigger aria-labelledby="at-mode" className="w-full md:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AT_SELECTABLE_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {t(MODE_OPTION_KEY[mode])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {connectorMode.help(connection.mode, "PT")} {t("modeLiveNote")}
        </p>
        {modeNotice ? (
          <p role="status" className={`text-sm ${TONE_CLASS[modeNotice.tone]}`}>
            {modeNotice.text}
          </p>
        ) : null}
      </section>

      <section className="space-y-2" aria-labelledby="at-check">
        <h3 id="at-check" className="text-sm font-medium">
          {t("checkTitle")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("checkHelp")}</p>
        <Button
          variant="outline"
          onClick={check}
          disabled={busy !== null || !inTestMode}
          className="w-full sm:w-auto"
        >
          {busy === "check" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("check")}
        </Button>
        {!inTestMode ? (
          <p className="text-xs text-muted-foreground">{t("testModeNeeded")}</p>
        ) : null}
        {checkNotice ? <NoticeLine notice={checkNotice} /> : null}
      </section>

      <section className="space-y-2" aria-labelledby="at-fetch">
        <h3 id="at-fetch" className="text-sm font-medium">
          {t("fetchTitle")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("fetchHelp")}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="at-contract">{t("contractNumber")}</Label>
            <Input
              id="at-contract"
              inputMode="numeric"
              value={contractNumber}
              onChange={(event) => setContractNumber(event.target.value.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="at-receipt">{t("receiptNumber")}</Label>
            <Input
              id="at-receipt"
              inputMode="numeric"
              value={receiptNumber}
              onChange={(event) => setReceiptNumber(event.target.value.trim())}
            />
          </div>
        </div>
        <Button
          variant="outline"
          onClick={fetchReceipt}
          disabled={
            busy !== null ||
            !inTestMode ||
            !wholeNumber(contractNumber) ||
            !wholeNumber(receiptNumber)
          }
          className="w-full sm:w-auto"
        >
          {busy === "fetch" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("fetch")}
        </Button>
        {fetchNotice ? <NoticeLine notice={fetchNotice} /> : null}
      </section>
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  const t = useTranslations("settings.at");
  return (
    <div role="status" className="space-y-0.5">
      <p className={`text-sm ${TONE_CLASS[notice.tone]}`}>{notice.text}</p>
      {notice.atMessage ? (
        <p className="text-xs text-muted-foreground">
          {t("atSays", { message: notice.atMessage })}
        </p>
      ) : null}
    </div>
  );
}
