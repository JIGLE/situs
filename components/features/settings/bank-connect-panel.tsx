"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Landmark,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  RotateCw,
  Trash2,
  TriangleAlert,
  Unplug,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import {
  BANK_SYNC_PROBLEM_KEY,
  useBankSync,
  type BankConnectionRow,
} from "@/lib/hooks/use-bank-connections";
import { formatDate } from "@/lib/utils/format-date";

interface Institution {
  id: string;
  name: string;
  country: string;
  maxHistoricalDays?: number;
}

/**
 * Countries this product serves. Not a full ISO list: offering a picker of 200 countries where
 * only two have working tax and receipt handling would promise something the rest of the app
 * does not do.
 */
const COUNTRIES = ["PT", "ES"] as const;

/**
 * Status and country labels are mapped explicitly rather than interpolated into `t()`. next-intl
 * throws on a missing key, so a status the server grows later would take the whole panel down at
 * render — the fallback here degrades to the raw word instead.
 */
const STATUS_LABEL_KEYS = {
  active: "bankStatus.active",
  pending_consent: "bankStatus.pendingConsent",
  expired: "bankStatus.expired",
  revoked: "bankStatus.revoked",
  error: "bankStatus.error",
} as const;

const COUNTRY_LABEL_KEYS = {
  PT: "bankCountry.PT",
  ES: "bankCountry.ES",
} as const;

const STATUS_STYLES: Record<string, string> = {
  active: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  pending_consent: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
  expired: "bg-[var(--semantic-danger-soft)] text-[var(--semantic-danger-readable)]",
  // Disconnected on purpose: a state, not a fault.
  revoked: "bg-[var(--color-muted)] text-muted-foreground",
  error: "bg-[var(--semantic-danger-soft)] text-[var(--semantic-danger-readable)]",
};

/** How asking the bank went, as the owner reads it once a disconnect is done. */
const DISCONNECT_NOTICE_KEYS = {
  revoked: "bankDisconnected",
  already_gone: "bankDisconnected",
  failed: "bankDisconnectedUnconfirmed",
  no_consent_id: "bankDisconnectedLocal",
  provider_unavailable: "bankDisconnectedLocal",
} as const;

interface Props {
  connections: BankConnectionRow[];
  providersConfigured: string[];
  loading: boolean;
  onRefresh: () => void;
}

/**
 * The bank connections: connect one, sync it, and from each row's menu rename, renew, disconnect
 * or remove it. What each row offers is decided by the server (`canRenew`, `canDisconnect`,
 * `canRemove`); this only shows it.
 *
 * Everything here is gated on `providersConfigured`, which answers two questions at once now
 * that no adapter ships: whether this build contains a provider at all, and whether this instance
 * has credentials for it. Either way the answer is how to configure one rather than a button
 * that can only fail.
 */
export function BankConnectPanel({ connections, providersConfigured, loading, onRefresh }: Props) {
  const t = useTranslations("settings.panel");
  const tActions = useTranslations("actions");
  const locale = useLocale();
  const { token: csrfToken } = useCsrf();
  const syncNow = useBankSync();
  const apiError = useApiError();
  const confirmDialog = useConfirmDialog();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [country, setCountry] = useState<string>(COUNTRIES[0]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  // Null until a listing comes back, so "not asked yet" never renders as "reaches no banks".
  const [totalAvailable, setTotalAvailable] = useState<number | null>(null);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<BankConnectionRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const configured = providersConfigured.length > 0;

  // The callback lands back here with ?bank=connected|renewed|failed. Reading it once and
  // clearing it keeps the message off every later visit to this tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("bank");
    if (!outcome) return;
    setNotice(
      outcome === "connected"
        ? t("bankConnected")
        : outcome === "renewed"
          ? t("bankRenewed")
          : null,
    );
    setError(outcome === "failed" ? t("bankConnectFailed") : null);
    params.delete("bank");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", next);
    if (outcome === "connected" || outcome === "renewed") onRefresh();
  }, [t, onRefresh]);

  /** The owner's name for a connection; a manual row's stored name is English, so it is not shown. */
  function displayName(connection: BankConnectionRow): string {
    if (connection.label) return connection.label;
    return connection.provider === "manual" ? t("bankManualName") : connection.institutionName;
  }

  const loadInstitutions = useCallback(
    async (code: string) => {
      setLoadingBanks(true);
      setError(null);
      try {
        // Not `{ data: { … } }`, for the same reason as `connect` below: the route replies
        // `createSuccessResponse({ providerKey, institutions, totalAvailable })` and `apiFetch`
        // has already returned the envelope's `data` field. Reading `.data` again produced
        // `undefined`, so the picker listed zero banks and reported "0 available" — meaning
        // this failed one step BEFORE the connect button did, and nobody could reach the
        // button to discover that it was broken too.
        const body = await apiFetch<{
          institutions?: Institution[];
          totalAvailable?: number;
        }>(
          `/api/bank/institutions?country=${encodeURIComponent(code)}` +
            `&provider=${encodeURIComponent(providersConfigured[0] ?? "")}`,
        );
        setInstitutions(body?.institutions ?? []);
        setTotalAvailable(body?.totalAvailable ?? 0);
      } catch {
        setInstitutions([]);
        // Back to "unknown", not zero. A failed request tells us nothing about what the provider
        // can reach, and claiming it reaches nothing would be inventing a diagnosis.
        setTotalAvailable(null);
        setError(t("bankInstitutionsFailed"));
      } finally {
        setLoadingBanks(false);
      }
    },
    [t, providersConfigured],
  );

  function openPicker() {
    setPickerOpen(true);
    void loadInstitutions(country);
  }

  function changeCountry(code: string) {
    setCountry(code);
    void loadInstitutions(code);
  }

  async function connect(institution: Institution) {
    setBusyId(institution.id);
    setError(null);
    try {
      // Not `{ data: { url } }`. `apiFetch` returns the envelope's `data` field when there is
      // one, and this route replies `createSuccessResponse({ connectionId, url })` — so reading
      // `.data` off the result unwrapped it twice, `url` came back undefined, and the connect
      // button threw "no url" and showed the generic failure message every single time. Same
      // defect as the document detail panel, and hidden the same way: the type argument
      // asserted the pre-unwrap shape, so nothing disagreed.
      const body = await apiFetch<{ connectionId?: string; url?: string }>(
        "/api/bank/connections/connect",
        csrfToken,
        "POST",
        {
          country: institution.country,
          institutionId: institution.id,
          institutionName: institution.name,
          // Named explicitly. The server used to take whichever provider sorted first, which
          // silently discarded the choice on an instance configured for more than one.
          providerKey: providersConfigured[0],
        },
      );
      const url = body?.url;
      if (!url) throw new Error("no url");
      // Leaves the app for the bank's own authentication.
      window.location.href = url;
    } catch {
      setError(t("bankConnectFailed"));
      setBusyId(null);
    }
  }

  /** A new consent for the same connection: the bank's page, then back to the callback. */
  async function renew(connection: BankConnectionRow) {
    setBusyId(connection.id);
    setError(null);
    setNotice(null);
    try {
      const body = await apiFetch<{ url?: string }>(
        `/api/bank/connections/${encodeURIComponent(connection.id)}/renew`,
        csrfToken,
        "POST",
      );
      if (!body?.url) {
        setError(t("bankConnectFailed"));
        setBusyId(null);
        return;
      }
      // Leaves the app for the bank's own authentication.
      window.location.href = body.url;
    } catch (err) {
      setError(apiError(err));
      setBusyId(null);
    }
  }

  function askToDisconnect(connection: BankConnectionRow) {
    confirmDialog.confirm(
      {
        title: t("bankDisconnectTitle", { name: displayName(connection) }),
        description: connection.revocable ? t("bankDisconnectBody") : t("bankDisconnectBodyLocal"),
        confirmLabel: t("bankDisconnect"),
        cancelLabel: tActions("cancel"),
        variant: "destructive",
      },
      () => disconnect(connection),
    );
  }

  async function disconnect(connection: BankConnectionRow) {
    setError(null);
    setNotice(null);
    try {
      const body = await apiFetch<{ revocation?: string }>(
        `/api/bank/connections/${encodeURIComponent(connection.id)}/disconnect`,
        csrfToken,
        "POST",
      );
      const key =
        DISCONNECT_NOTICE_KEYS[body?.revocation as keyof typeof DISCONNECT_NOTICE_KEYS] ??
        "bankDisconnectedLocal";
      setNotice(t(key));
      onRefresh();
    } catch (err) {
      setError(apiError(err));
    }
  }

  function askToRemove(connection: BankConnectionRow) {
    confirmDialog.confirm(
      {
        title: t("bankRemoveTitle", { name: displayName(connection) }),
        description: t("bankRemoveBody"),
        confirmLabel: t("bankRemove"),
        cancelLabel: tActions("cancel"),
        variant: "destructive",
      },
      () => remove(connection),
    );
  }

  async function remove(connection: BankConnectionRow) {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(
        `/api/bank/connections/${encodeURIComponent(connection.id)}`,
        csrfToken,
        "DELETE",
      );
      setNotice(t("bankRemoved"));
      onRefresh();
    } catch (err) {
      setError(apiError(err));
    }
  }

  function startRenaming(connection: BankConnectionRow) {
    setRenaming(connection);
    setRenameValue(connection.label ?? "");
    setRenameError(null);
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (!renaming) return;
    setSavingName(true);
    setRenameError(null);
    try {
      // Empty goes back to the bank's name; the server trims.
      await apiFetch(
        `/api/bank/connections/${encodeURIComponent(renaming.id)}`,
        csrfToken,
        "PATCH",
        { label: renameValue },
      );
      setRenaming(null);
      setError(null);
      setNotice(t("bankRenamed"));
      onRefresh();
    } catch (err) {
      setRenameError(apiError(err));
    } finally {
      setSavingName(false);
    }
  }

  async function sync(connection: BankConnectionRow) {
    setBusyId(connection.id);
    setError(null);
    setNotice(null);
    const outcome = await syncNow(connection.id);
    if (outcome.ok) {
      setNotice(t("bankSyncDone"));
      onRefresh();
    } else {
      setError(t(BANK_SYNC_PROBLEM_KEY[outcome.problem]));
    }
    setBusyId(null);
  }

  function statusLabel(status: string): string {
    const key = STATUS_LABEL_KEYS[status as keyof typeof STATUS_LABEL_KEYS];
    return key ? t(key) : status.replace(/_/g, " ");
  }

  return (
    <div className="space-y-3">
      {notice ? (
        <p className="rounded-md bg-[var(--semantic-success-soft)] px-3 py-2 text-sm text-[var(--semantic-success-readable)]">
          {notice}
        </p>
      ) : null}
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
      ) : connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noBankConnection")}</p>
      ) : (
        <div className="space-y-2">
          {connections.map((c) => (
            <div
              key={c.id}
              className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--color-foreground)]">
                  {displayName(c)}
                </p>
                {c.label ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {c.provider === "manual" ? t("bankManualName") : c.institutionName}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {t("bankLastSync", {
                    date: formatDate(c.lastSyncAt, locale, t("bankNeverSynced")),
                  })}
                  {c.canSync && c.remainingBudget !== null
                    ? ` · ${t("bankSyncsLeft", { count: c.remainingBudget })}`
                    : ""}
                </p>
                {c.consentExpiresAt && c.status !== "revoked" ? (
                  <p className="text-xs text-muted-foreground">
                    {t("bankConsentUntil", { date: formatDate(c.consentExpiresAt, locale) })}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[c.status] ?? ""}`}
                >
                  {statusLabel(c.status)}
                </span>

                {c.status === "expired" ? (
                  // The same connection, renewed: its accounts keep their ids, so the movements
                  // seen before and after dedupe instead of waiting in review twice.
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void renew(c)}
                    disabled={!c.canRenew || busyId === c.id}
                  >
                    {busyId === c.id ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <TriangleAlert className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {t("bankRenew")}
                  </Button>
                ) : c.canSync ? (
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
                    {t("bankSyncNow")}
                  </Button>
                ) : null}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label={t("bankActions", { name: displayName(c) })}
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => startRenaming(c)}>
                      <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                      {t("bankRename")}
                    </DropdownMenuItem>
                    {c.canRenew ? (
                      <DropdownMenuItem onClick={() => void renew(c)}>
                        <RotateCw className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t("bankRenew")}
                      </DropdownMenuItem>
                    ) : null}
                    {c.canDisconnect ? (
                      <DropdownMenuItem onClick={() => askToDisconnect(c)}>
                        <Unplug className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t("bankDisconnect")}
                      </DropdownMenuItem>
                    ) : null}
                    {c.canRemove ? (
                      <DropdownMenuItem onClick={() => askToRemove(c)}>
                        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t("bankRemove")}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {configured ? (
        <Button variant="outline" onClick={openPicker} className="w-full sm:w-auto">
          <Landmark className="mr-2 h-4 w-4" />
          {t("bankConnectCta")}
        </Button>
      ) : (
        <div className="rounded-md border border-[var(--color-border)] px-3 py-2.5">
          <p className="text-sm font-medium text-[var(--color-foreground)]">
            {t("bankNoProviderTitle")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t("bankNoProviderBody")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t("bankNoProviderManual")}</p>
        </div>
      )}

      <ConfirmationDialog dialog={confirmDialog} />

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent>
          <form onSubmit={(event) => void saveName(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("bankRenameTitle")}</DialogTitle>
              <DialogDescription>
                {renaming
                  ? t("bankRenameHelp", {
                      bank:
                        renaming.provider === "manual"
                          ? t("bankManualName")
                          : renaming.institutionName,
                    })
                  : null}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="bank-connection-label">{t("bankRenameLabel")}</Label>
              <Input
                id="bank-connection-label"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                maxLength={60}
                autoComplete="off"
              />
              {renameError ? (
                <p role="alert" className="text-sm text-[var(--semantic-danger-readable)]">
                  {renameError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                {tActions("cancel")}
              </Button>
              <Button type="submit" disabled={savingName}>
                {savingName ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {tActions("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t("bankPickerTitle")}</SheetTitle>
            <SheetDescription>{t("bankPickerHelp")}</SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <Select value={country} onValueChange={changeCountry}>
              <SelectTrigger aria-label={t("bankCountryLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {t(COUNTRY_LABEL_KEYS[code])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {loadingBanks ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : institutions.length === 0 ? (
              // Three different problems with three different remedies. They used to share one
              // message that named the country, which is the one thing that was never the cause.
              <p className="text-sm text-muted-foreground">
                {totalAvailable === null
                  ? t("bankNoInstitutions")
                  : totalAvailable === 0
                    ? t("bankNoInstitutionsAtAll")
                    : t("bankNoInstitutionsHere", {
                        count: totalAvailable,
                        country: t(COUNTRY_LABEL_KEYS[country as keyof typeof COUNTRY_LABEL_KEYS]),
                      })}
              </p>
            ) : (
              <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
                {institutions.map((bank) => (
                  <li key={bank.id}>
                    <button
                      type="button"
                      onClick={() => void connect(bank)}
                      disabled={busyId === bank.id}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm hover:bg-[var(--color-muted)] disabled:opacity-60"
                    >
                      <span className="truncate">{bank.name}</span>
                      {busyId === bank.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default BankConnectPanel;
