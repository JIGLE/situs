"use client";

import { PageHeader } from "@/components/shared/page-header";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils/utils";
import { useToast } from "@/lib/contexts/toast-context";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useTheme } from "@/lib/contexts/theme-context";
import { useUserSettings } from "@/lib/contexts/user-settings-context";
import { LegalLinks } from "@/components/shared/legal-links";
import { SettingsAccount } from "./settings-account";
import { SettingsAppearance } from "./settings-appearance";
import { SettingsData } from "./settings-data";
import { SettingsNotifications } from "./settings-notifications";
import { SettingsSecurity } from "./settings-security";
import { SettingsSystem } from "./settings-system";
import { SettingsIntegrations } from "./settings-integrations";
import { defaultSettings, type UserSettings } from "./settings-types";

/**
 * Section ids, in order. Labels resolve against `settings.nav` at render.
 *
 * One subject each: the account and how the app looks for it, the sign-in factor, the e-mails, the
 * outside connections, the owner's own data, and the instance. They were grouped under "Pessoal"
 * and "Sistema" headings, which repeated the menu's own "Sistema" and split the account's two
 * country settings (tax residence, palette) across two sections. Administration is listed only for
 * an administrator, who is the only one its APIs answer.
 */
const SECTIONS = [
  "account",
  "security",
  "notifications",
  "integrations",
  "data",
  "system",
] as const;
type SectionValue = (typeof SECTIONS)[number];

function isSection(value: string | null): value is SectionValue {
  return (SECTIONS as readonly (string | null)[]).includes(value);
}

/** How long after the last change a save goes out, so a run of switches is one request. */
const SAVE_DELAY_MS = 600;

export function SettingsView(): React.ReactElement {
  const { data: session } = useSession();
  const { success, error: showError } = useToast();
  const t = useTranslations("settings.nav");
  const tNav = useTranslations("navigation");
  const tPanel = useTranslations("settings.panel");
  const { token: csrfToken } = useCsrf();
  const { setTheme } = useTheme();
  const { refresh: refreshAccount } = useUserSettings();
  const searchParams = useSearchParams();

  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [appVersion, setAppVersion] = useState<string>("");

  const isAdmin = session?.user?.role === "ADMIN";
  const sections: readonly SectionValue[] = SECTIONS.filter((s) => s !== "system" || isAdmin);

  // `?tab=` opens a section. Old links name `appearance`, now part of Account. On a phone, no
  // `?tab=` shows the list of sections rather than the first one, as phone settings do.
  const requestedTab = searchParams.get("tab");
  const initial: SectionValue | null =
    requestedTab === "appearance" ? "account" : isSection(requestedTab) ? requestedTab : null;
  const [activeSection, setActiveSection] = useState<SectionValue | null>(initial);
  const visibleSection: SectionValue =
    activeSection && sections.includes(activeSection) ? activeSection : "account";

  // The open section is kept in the URL, so a reload opens it again. So does a language switch:
  // the page is rendered afresh under the new locale.
  const selectSection = (section: SectionValue | null) => {
    setActiveSection(section);
    const params = new URLSearchParams(searchParams.toString());
    if (section) params.set("tab", section);
    else params.delete("tab");
    // `view` is a tab inside one section (Connections); it means nothing in another.
    params.delete("view");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  };

  useEffect(() => {
    loadSettings();
    fetch("/version.json")
      .then((r) => r.json())
      .then((d) => setAppVersion(d.version || ""))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSettings = async () => {
    if (!session?.user) {
      setLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/settings");
      if (response.ok) {
        const data = await response.json();
        if (data.data) {
          setSettings({ ...defaultSettings, ...data.data });
        }
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  };

  // Every change saves itself. There was a Guardar button that appeared at the top once something
  // changed, while 2FA, the bank and the language took effect at once: leaving the page dropped an
  // unsaved switch without a word. Changes within SAVE_DELAY_MS go out as one request, and one
  // still waiting when the page closes is sent then.
  const pending = useRef<UserSettings | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (next: UserSettings) => {
      try {
        const response = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken || "" },
          body: JSON.stringify(next),
          keepalive: true,
        });
        if (!response.ok) throw new Error(String(response.status));
        success(t("toastSaved"));
        // The rail's line under the owner's name reads the account's row: re-read it, so a new
        // country of residence shows there at once.
        void refreshAccount();
      } catch {
        showError(t("toastSaveFailed"));
      }
    },
    [csrfToken, refreshAccount, showError, success, t],
  );

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next) void save(next);
  }, [save]);

  // Leaving Settings sends whatever is still waiting.
  useEffect(() => flush, [flush]);

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      pending.current = next;
      return next;
    });
    if (key === "theme") setTheme(value as UserSettings["theme"]);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const about = (
    <div className="space-y-1 px-3 pt-4 text-xs text-[var(--color-muted-foreground)]">
      {appVersion && (
        <p className="flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" aria-hidden />
          {tPanel("version", { version: appVersion })}
        </p>
      )}
      <LegalLinks className="-ml-1 justify-start" />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={tNav("settings")} />

      <div className="grid gap-6 md:grid-cols-[clamp(180px,16vw,260px)_minmax(0,1fr)]">
        {/* The sections, once: a rail beside the open section on a computer, and on a phone the
            screen Settings opens on, a list whose rows each open one section (a dropdown showing
            "Conta ▾" hid what else Settings holds). Weight and colour mark the open section on
            the rail, not the accent bar, which is the main menu's "where you are". */}
        <nav
          aria-label={t("sectionsLabel")}
          className={cn(activeSection !== null && "max-md:hidden")}
        >
          <div className="max-md:divide-y max-md:divide-[var(--color-border)] max-md:border max-md:border-[var(--color-inner-border)] max-md:bg-[var(--color-surface-solid)] md:space-y-0.5">
            {sections.map((section) => {
              const current = visibleSection === section;
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => selectSection(section)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 text-left text-sm transition-colors",
                    "max-md:min-h-12 max-md:px-4 max-md:py-3 md:px-3 md:py-1.5",
                    current
                      ? "md:bg-[var(--color-hover)] md:font-medium md:text-[var(--color-foreground)]"
                      : "md:text-[var(--color-muted-foreground)] md:hover:bg-[var(--color-hover)] md:hover:text-[var(--color-foreground)]",
                  )}
                >
                  {t(section)}
                  <ChevronRight
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)] md:hidden"
                  />
                </button>
              );
            })}
          </div>
          {about}
        </nav>

        {activeSection !== null && (
          <button
            type="button"
            onClick={() => selectSection(null)}
            className="-mt-2 -ml-1 flex min-h-11 items-center gap-1 text-sm text-[var(--color-muted-foreground)] md:hidden"
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
            {tNav("settings")}
          </button>
        )}

        <div
          className={cn(
            "min-w-0 space-y-6",
            // Forms stay near their labels; Administration's panels sit side by side, so it
            // takes the column's width.
            visibleSection !== "system" && "max-w-3xl",
            activeSection === null && "max-md:hidden",
          )}
        >
          {/* On a phone the open section names itself, since the list that named it is gone. */}
          <h2 className="text-lg font-semibold md:hidden">{t(visibleSection)}</h2>
          {visibleSection === "account" && (
            <>
              <SettingsAccount settings={settings} updateSetting={updateSetting} />
              <SettingsAppearance settings={settings} updateSetting={updateSetting} />
            </>
          )}
          {visibleSection === "security" && <SettingsSecurity />}
          {visibleSection === "notifications" && (
            <SettingsNotifications settings={settings} updateSetting={updateSetting} />
          )}
          {visibleSection === "integrations" && <SettingsIntegrations />}
          {visibleSection === "data" && <SettingsData />}
          {visibleSection === "system" && <SettingsSystem />}
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
