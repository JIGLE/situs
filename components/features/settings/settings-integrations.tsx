"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Landmark, Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AtConnectionPanel } from "./at-connection-panel";
import { useBankConnections } from "@/lib/hooks/use-bank-connections";
import { BankConnectPanel } from "./bank-connect-panel";

/** The tabs, as `?view=` names them. Banks comes first and is the default. */
const VIEWS = ["banks", "at"] as const;
type IntegrationView = (typeof VIEWS)[number];

function isView(value: string | null): value is IntegrationView {
  return (VIEWS as readonly (string | null)[]).includes(value);
}

/**
 * The instance's outside connections, a tab each: the bank, and Finanças. Each sets up and checks
 * its connection; the explainability behind them (the bank movement inbox, the tax submission log)
 * lives in Finance, and this section does not repeat it.
 *
 * - Two short labels fit at 390px in every language, so the bar stays a bar at every width.
 * - Banks is the default: the bank's consent callback lands on `?tab=integrations&bank=…`, and the
 *   panel that reads `bank=` has to be the one showing. `?view=at` opens Finanças.
 * - The tab label is each tab's heading, so the cards under it have no title of their own. They
 *   had one each, "Ligações bancárias" and "Finanças (AT)", when all of them sat on one page.
 * - A third card, "Classificador simulado", described a document classifier removed long ago.
 */
export function SettingsIntegrations() {
  const t = useTranslations("settings.panel");
  const tAt = useTranslations("settings.at");
  const tNav = useTranslations("settings.nav");
  const searchParams = useSearchParams();
  const requested = searchParams.get("view");
  const [view, setView] = useState<IntegrationView>(isView(requested) ? requested : "banks");
  const { connections, providersConfigured, loading, reload } = useBankConnections();

  // In the URL like the section itself, so a reload opens the same tab.
  const selectView = (next: string) => {
    if (!isView(next)) return;
    setView(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    window.history.replaceState(null, "", `?${params.toString()}`);
  };

  return (
    <Tabs value={view} onValueChange={selectView} className="space-y-4">
      <TabsList aria-label={tNav("integrations")}>
        <TabsTrigger value="banks" className="gap-2">
          <Landmark aria-hidden className="h-4 w-4 shrink-0" />
          {t("integrationTabs.banks")}
        </TabsTrigger>
        <TabsTrigger value="at" className="gap-2">
          <Layers aria-hidden className="h-4 w-4 shrink-0" />
          {t("integrationTabs.at")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="banks" className="mt-0">
        <Card>
          <CardHeader>
            <CardDescription>{t("bankConnectionsHelp")}</CardDescription>
          </CardHeader>
          <CardContent>
            <BankConnectPanel
              connections={connections}
              providersConfigured={providersConfigured}
              loading={loading}
              onRefresh={reload}
            />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="at" className="mt-0">
        <Card>
          <CardHeader>
            <CardDescription>{tAt("description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <AtConnectionPanel />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

export default SettingsIntegrations;
