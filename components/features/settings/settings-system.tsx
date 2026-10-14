"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Panel } from "@/components/shared/panel";
import { Button } from "@/components/ui/button";

/**
 * Settings › System.
 *
 * This panel used to render a second system-status readout — database latency, uptime,
 * environment, email provider — fetched from `/api/health`. That duplicated `/admin` in a
 * user-facing screen, with a thinner and slightly different set of checks, so the two could
 * disagree and the one a non-admin saw was the less accurate of them.
 *
 * Instance health now lives in the admin area, which has its own shell precisely because it is
 * not part of the app. What remains here is a way across for anyone who came looking for the
 * status they remember.
 */
export function SettingsSystem() {
  const t = useTranslations("settings.panel");
  const router = useRouter();

  return (
    <div className="space-y-6">
      <Panel title={t("systemStatus")} description={t("systemStatusMovedHelp")} padded>
        <Button variant="outline" size="sm" onClick={() => router.push("/admin")}>
          <ShieldCheck className="h-4 w-4 mr-1.5" />
          {t("openAdmin")}
        </Button>
      </Panel>
    </div>
  );
}

export default SettingsSystem;
