"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Landmark, Loader2, RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { useCsrf } from "@/lib/contexts/csrf-context";

export interface BankConnectionRow {
  id: string;
  provider: string;
  institutionName: string;
  status: string;
  lastSyncAt: string | null;
  consentExpiresAt: string | null;
  isProvider: boolean;
  canSync: boolean;
  remainingBudget: number | null;
}

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
  revoked: "bg-[var(--semantic-danger-soft)] text-[var(--semantic-danger-readable)]",
  error: "bg-[var(--semantic-danger-soft)] text-[var(--semantic-danger-readable)]",
};

interface Props {
  connections: BankConnectionRow[];
  providersConfigured: string[];
  loading: boolean;
  onRefresh: () => void;
}

/**
 * The connect / sync / reconnect affordances for live bank connections.
 *
 * Everything here is gated on `providersConfigured`, which answers two questions at once now
 * that no adapter ships: whether this build contains a provider at all, and whether this instance
 * has credentials for it. Either way the answer is the CSV-only view rather than a button that
 * can only fail.
 */
export function BankConnectPanel({ connections, providersConfigured, loading, onRefresh }: Props) {
  const t = useTranslations("settings.panel");
  const locale = useLocale();
  const { token: csrfToken } = useCsrf();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [country, setCountry] = useState<string>(COUNTRIES[0]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  // Null until a listing comes back, so "not asked yet" never renders as "reaches no banks".
  const [totalAvailable, setTotalAvailable] = useState<number | null>(null);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const configured = providersConfigured.length > 0;

  // The callback lands back here with ?bank=connected|failed. Reading it once and clearing it
  // keeps the message off every later visit to this tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("bank");
    if (!outcome) return;
    setNotice(outcome === "connected" ? t("bankConnected") : null);
    setError(outcome === "failed" ? t("bankConnectFailed") : null);
    params.delete("bank");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", next);
    if (outcome === "connected") onRefresh();
  }, [t, onRefresh]);

  const loadInstitutions = useCallback(
    async (code: string) => {
      setLoadingBanks(true);
      setError(null);
      try {
        const body = await apiFetch<{
          data?: { institutions?: Institution[]; totalAvailable?: number };
        }>(
          `/api/bank/institutions?country=${encodeURIComponent(code)}` +
            `&provider=${encodeURIComponent(providersConfigured[0] ?? "")}`,
        );
        setInstitutions(body?.data?.institutions ?? []);
        setTotalAvailable(body?.data?.totalAvailable ?? 0);
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

  async function sync(connection: BankConnectionRow) {
    setBusyId(connection.id);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/bank/connections/${connection.id}/sync`, csrfToken, "POST", {});
      setNotice(t("bankSyncDone"));
      onRefresh();
    } catch (err) {
      // The budget and the expired consent are different problems with different remedies, so
      // they must not collapse into one "try again" that is wrong for both.
      const status = (err as { status?: number })?.status;
      setError(
        status === 429
          ? t("bankSyncBudgetSpent")
          : status === 409
            ? t("bankSyncConsentExpired")
            : t("bankSyncFailed"),
      );
    } finally {
      setBusyId(null);
    }
  }

  function statusLabel(status: string): string {
    const key = STATUS_LABEL_KEYS[status as keyof typeof STATUS_LABEL_KEYS];
    return key ? t(key) : status.replace(/_/g, " ");
  }

  function formatDate(value: string | null): string {
    if (!value) return t("bankNeverSynced");
    const d = new Date(value);
    return isNaN(d.getTime()) ? t("bankNeverSynced") : d.toLocaleDateString(locale);
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
                  {c.institutionName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("bankLastSync", { date: formatDate(c.lastSyncAt) })}
                  {c.canSync && c.remainingBudget !== null
                    ? ` · ${t("bankSyncsLeft", { count: c.remainingBudget })}`
                    : ""}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[c.status] ?? ""}`}
                >
                  {statusLabel(c.status)}
                </span>

                {c.status === "expired" ? (
                  <Button size="sm" variant="outline" onClick={openPicker} disabled={!configured}>
                    <TriangleAlert className="mr-1.5 h-3.5 w-3.5" />
                    {t("bankReconnect")}
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
          <p className="mt-2 text-sm text-muted-foreground">{t("bankNoProviderCsv")}</p>
        </div>
      )}

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
