"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Save, Settings } from "lucide-react";
import { useSession } from "next-auth/react";
import { getPortalRoleFromSessionRole, type PortalRole } from "@/lib/portal/access";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils/utils";
import { useToast } from "@/lib/contexts/toast-context";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useTheme } from "@/lib/contexts/theme-context";
import { SettingsAccount } from "./settings-account";
import { SettingsAppearance } from "./settings-appearance";
import { SettingsTax } from "./settings-tax";
import { SettingsNotifications } from "./settings-notifications";
import { SettingsSecurity } from "./settings-security";
import { SettingsSystem } from "./settings-system";
import { SettingsIntegrations } from "./settings-integrations";
import { SettingsBilling } from "./settings-billing";
import { defaultSettings, type BillingInfo, type UserSettings } from "./settings-types";

/**
 * Section ids only — labels resolve against `settings.nav` at render.
 *
 * `roles` gates the section, not the route: Settings is reachable by both roles because it now
 * hosts Account, but a tenant has no tax rules, integrations or billing to configure.
 */
const SECTIONS = [
  // Grouped by whose settings they are, which is the split every settings screen worth copying
  // uses: what belongs to YOU, what belongs to the BUSINESS you run in here, and what belongs to
  // the INSTANCE. Eight equal-weight entries in arrival order made a reader scan all eight to
  // find one; three short groups make most lookups stop at the heading.
  { id: "account", group: "personal", roles: ["owner", "tenant"] },
  { id: "security", group: "personal", roles: ["owner", "tenant"] },
  { id: "appearance", group: "personal", roles: ["owner", "tenant"] },
  { id: "notifications", group: "personal", roles: ["owner"] },
  { id: "tax", group: "workspace", roles: ["owner"] },
  { id: "billing", group: "workspace", roles: ["owner"] },
  { id: "integrations", group: "system", roles: ["owner"] },
  { id: "system", group: "system", roles: ["owner"] },
] as const satisfies readonly {
  id: string;
  group: SectionGroup;
  roles: readonly PortalRole[];
}[];

/** Group order is the render order. A group with no visible sections renders nothing. */
const GROUPS = ["personal", "workspace", "system"] as const;
type SectionGroup = (typeof GROUPS)[number];

type SectionValue = (typeof SECTIONS)[number]["id"];

export function SettingsView(): React.ReactElement {
  const { data: session } = useSession();
  const { success, error: showError } = useToast();
  const t = useTranslations("settings.nav");
  const tForms = useTranslations("forms");
  const tActions = useTranslations("actions");
  const { token: csrfToken } = useCsrf();
  const { setTheme } = useTheme();
  const searchParams = useSearchParams();

  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("");

  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  // Whether to surface any subscription UI at all. Off on self-hosted instances
  // (ENABLE_BILLING unset) so the account never sees subscription framing.
  const showBilling = billing?.billingEnabled === true;

  const role = getPortalRoleFromSessionRole(session?.user?.role);
  const visible = SECTIONS.filter(
    (s) => (s.roles as readonly PortalRole[]).includes(role) && (s.id !== "billing" || showBilling),
  );
  const sections: readonly SectionValue[] = visible.map((s) => s.id);
  // Groups that actually have something in them for this role. A tenant sees only "personal",
  // and an empty heading is worse than no heading.
  const groupedSections = GROUPS.map((group) => ({
    group,
    ids: visible.filter((s) => s.group === group).map((s) => s.id),
  })).filter((g) => g.ids.length > 0);

  // A `?tab=` the current role can't see (a stale link, or an owner URL opened by a tenant)
  // falls back to the first section rather than rendering an empty panel.
  const requestedTab = searchParams.get("tab") as SectionValue | null;
  const [activeSection, setActiveSection] = useState<SectionValue>(
    requestedTab && (SECTIONS as readonly { id: string }[]).some((s) => s.id === requestedTab)
      ? requestedTab
      : "account",
  );
  const visibleSection = sections.includes(activeSection) ? activeSection : sections[0];

  /** `tax` is the section id; its label lives under a different key. */
  const sectionLabel = (value: SectionValue) =>
    value === "tax" ? t("taxRegion") : t(value as Exclude<SectionValue, "tax">);

  useEffect(() => {
    loadSettings();
    loadBilling();
    fetch("/version.json")
      .then((r) => r.json())
      .then((d) => setAppVersion(d.version || ""))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout === "success") {
      success(t("toastSubscription"));
    } else if (checkout === "canceled") {
      showError(t("toastCanceled"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadBilling = async () => {
    try {
      const response = await fetch("/api/billing/subscription");
      if (response.ok) {
        const data = await response.json();
        if (data.data) setBilling(data.data);
      }
    } catch (err) {
      console.error("Failed to load billing info:", err);
    } finally {
      setBillingLoading(false);
    }
  };

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

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken || "" },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        success(t("toastSaved"));
        setHasChanges(false);
        setTheme(settings.theme);
      } else {
        showError(t("toastSaveFailed"));
      }
    } catch {
      showError(t("toastSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)] flex items-center gap-2">
            <Settings className="h-6 w-6" />
            {t("heading")}
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("subtitle")}</p>
        </div>
        {hasChanges && (
          <Button onClick={saveSettings} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? tForms("saving") : tActions("save")}
          </Button>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-[clamp(180px,16vw,260px)_minmax(0,1fr)]">
        {/* Desktop vertical section nav.

            This used to borrow the main sidebar's language exactly — `border-l-2` in the country
            accent, the same active fill, the same `.mono-label` group headings — on the reasoning
            that Settings should read as its own mini nav. At 1440 the result is two vertical
            navigations sitting side by side in identical dress, and the eye ranks them equally
            when one of them is the app and the other is one page of it.

            So the accent bar goes. It is the sidebar's signature for "where you are in the app",
            and a section rail one level down should not claim it. Weight and foreground colour
            carry the active state instead, which is enough at this size and leaves the sidebar
            as the only thing in the viewport wearing the accent.

            The group headings stay. They are not decoration: eight equal-weight entries in
            arrival order made a reader scan all eight, and three short groups stop most lookups
            at the heading — see the SECTIONS comment above. */}
        <nav aria-label={t("sectionsLabel")} className="hidden md:block">
          <div className="space-y-3">
            {groupedSections.map(({ group, ids }) => (
              <div key={group} className="space-y-0.5">
                <h3 className="mono-label px-3 pb-0.5">{t(`groups.${group}`)}</h3>
                {ids.map((section) => (
                  <button
                    key={section}
                    type="button"
                    onClick={() => setActiveSection(section)}
                    aria-current={visibleSection === section ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors",
                      visibleSection === section
                        ? "bg-[var(--color-hover)] font-medium text-[var(--color-foreground)]"
                        : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-hover)] hover:text-[var(--color-foreground)]",
                    )}
                  >
                    {sectionLabel(section)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>

        {/* Mobile section picker */}
        <div className="md:hidden">
          <Select
            value={visibleSection}
            onValueChange={(value: string) => setActiveSection(value as SectionValue)}
          >
            {/* The desktop rail above is a labelled <nav>; this is its below-`md` substitute and
                needs its own name. Without one it announced nothing at all — `SelectValue` is the
                trigger's only content and it renders no accessible text until a value resolves,
                so the primary way to move around Settings on a phone was anonymous. Found by the
                first run of the mobile-chrome Playwright project. */}
            <SelectTrigger aria-label={t("sectionsLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sections.map((section) => (
                <SelectItem key={section} value={section}>
                  {sectionLabel(section)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Capped, not full-bleed. The panel column runs ~900px at 1440, and what sits in it is
            label-over-value pairs and single-column forms — so every field was a short string
            floating at the left edge of a very wide bordered box, which is what made Settings
            read as heavy while being mostly empty. `3xl` is wide enough for the two-column
            grids inside Appearance and Tax and narrow enough that a value stays near its label. */}
        <div className="min-w-0 max-w-3xl">
          {visibleSection === "account" && <SettingsAccount appVersion={appVersion} />}
          {visibleSection === "tax" && (
            <SettingsTax settings={settings} updateSetting={updateSetting} />
          )}
          {visibleSection === "notifications" && (
            <SettingsNotifications settings={settings} updateSetting={updateSetting} />
          )}
          {visibleSection === "appearance" && (
            <SettingsAppearance settings={settings} updateSetting={updateSetting} />
          )}
          {visibleSection === "security" && <SettingsSecurity />}
          {visibleSection === "integrations" && <SettingsIntegrations />}
          {visibleSection === "system" && <SettingsSystem />}
          {visibleSection === "billing" && showBilling && (
            <SettingsBilling billing={billing} billingLoading={billingLoading} />
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
