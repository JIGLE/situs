"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Lock, Shield } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import { useToast } from "@/lib/contexts/toast-context";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";

export function SettingsSecurity() {
  const { success, error: showError } = useToast();
  const { token: csrfToken } = useCsrf();
  const t = useTranslations("settings.panel");
  const tActions = useTranslations("actions");
  const confirmDialog = useConfirmDialog();

  const exportData = async () => {
    try {
      const res = await fetch("/api/user/export-data", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken || "" },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "situs-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showError(t("exportFailed"));
    }
  };

  /** Was a native `window.confirm`, which cannot be translated and is the one pattern the
   *  rest of the app routes through ConfirmationDialog instead. */
  const requestDelete = () => {
    confirmDialog.confirm(
      {
        title: t("deleteConfirmTitle"),
        description: t("deleteConfirmDescription"),
        confirmLabel: t("deleteConfirmLabel"),
        variant: "destructive",
      },
      async () => {
        try {
          const res = await fetch("/api/user/delete-data", {
            method: "POST",
            headers: { "X-CSRF-Token": csrfToken || "" },
          });
          if (!res.ok) throw new Error("Delete failed");
          window.location.href = "/auth/signin";
        } catch {
          showError(t("deleteFailed"));
        }
      },
    );
  };

  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpLoading, setTotpLoading] = useState(true);
  const [totpSetupStep, setTotpSetupStep] = useState<"idle" | "qr" | "verify" | "backup">("idle");
  const [totpQr, setTotpQr] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpBackupCodes, setTotpBackupCodes] = useState<string[]>([]);
  const [totpWorking, setTotpWorking] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/totp/status");
        if (res.ok) {
          const d = await res.json();
          setTotpEnabled(d.totpEnabled ?? false);
        }
      } catch {
        // ignore
      } finally {
        setTotpLoading(false);
      }
    })();
  }, []);

  const startTotpSetup = async () => {
    setTotpWorking(true);
    try {
      const res = await fetch("/api/auth/totp/setup", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken || "" },
      });
      if (!res.ok) throw new Error("Setup failed");
      const d = await res.json();
      setTotpQr(d.qrDataUrl);
      setTotpSecret(d.secret);
      setTotpCode("");
      setTotpSetupStep("qr");
    } catch {
      showError(t("toastEnableFailed"));
    } finally {
      setTotpWorking(false);
    }
  };

  const confirmTotpEnable = async () => {
    setTotpWorking(true);
    try {
      const res = await fetch("/api/auth/totp/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken || "" },
        body: JSON.stringify({ code: totpCode }),
      });
      if (!res.ok) {
        const d = await res.json();
        showError(d.error ?? "Invalid code");
        return;
      }
      const d = await res.json();
      setTotpBackupCodes(d.backupCodes);
      setTotpEnabled(true);
      setTotpSetupStep("backup");
      success(t("toastEnabled"));
    } catch {
      showError(t("toastVerifyFailed"));
    } finally {
      setTotpWorking(false);
    }
  };

  const disableTotp = async () => {
    setTotpWorking(true);
    try {
      const res = await fetch("/api/auth/totp/disable", {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrfToken || "" },
      });
      if (!res.ok) throw new Error("Disable failed");
      setTotpEnabled(false);
      setTotpSetupStep("idle");
      success(t("toastDisabled"));
    } catch {
      showError(t("toastDisableFailed"));
    } finally {
      setTotpWorking(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {t("twoFactor")}
          </CardTitle>
          <CardDescription>{t("twoFactorDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {totpLoading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : totpEnabled && totpSetupStep !== "backup" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>{t("twoFactorOn")}</span>
              </div>
              <Button variant="destructive" size="sm" onClick={disableTotp} disabled={totpWorking}>
                {t("disable2fa")}
              </Button>
            </div>
          ) : totpSetupStep === "idle" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("twoFactorIntro")}</p>
              <Button size="sm" onClick={startTotpSetup} disabled={totpWorking}>
                {totpWorking ? t("loading") : t("setUp2fa")}
              </Button>
            </div>
          ) : totpSetupStep === "qr" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("scanQr")}</p>
              {totpQr && (
                <picture>
                  <img src={totpQr} alt={t("qrAlt")} className="w-48 h-48 rounded-lg" />
                </picture>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">{t("cantScan")}</summary>
                <code className="block mt-2 p-2 bg-muted rounded text-xs break-all select-all">
                  {totpSecret}
                </code>
              </details>
              <div className="space-y-2">
                <Label htmlFor="totp-code">{t("verificationCode")}</Label>
                <Input
                  id="totp-code"
                  type="text"
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  className="w-40 text-center tracking-widest text-lg"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={confirmTotpEnable}
                  disabled={totpWorking || totpCode.length !== 6}
                >
                  {totpWorking ? t("verifying") : t("enable2fa")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTotpSetupStep("idle")}
                  disabled={totpWorking}
                >
                  {tActions("cancel")}
                </Button>
              </div>
            </div>
          ) : totpSetupStep === "backup" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>{t("twoFactorEnabled")}</span>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("backupCodes")}</p>
                <p className="text-sm text-muted-foreground">{t("backupCodesHelp")}</p>
                <div className="grid grid-cols-2 gap-1.5 p-3 bg-muted rounded-lg font-mono text-sm">
                  {totpBackupCodes.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(totpBackupCodes.join("\n"))
                      .then(() => success(t("codesCopied")))
                      .catch(() => {});
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t("copyCodes")}
                </Button>
              </div>
              <Button size="sm" onClick={() => setTotpSetupStep("idle")}>
                {t("done")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* GDPR data rights. These sat under Account, which also held identity fields and the
          appearance controls; they belong with the other account-level risk surface. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t("dataRights")}
          </CardTitle>
          <CardDescription>{t("dataRightsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-4 space-y-2">
              <p className="text-sm font-medium">{t("exportTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("exportHelp")}</p>
              <Button variant="outline" size="sm" onClick={exportData}>
                {t("exportTitle")}
              </Button>
            </div>
            <div className="rounded-lg border border-destructive/30 p-4 space-y-2">
              <p className="text-sm font-medium text-destructive">{t("deleteTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("deleteHelp")}</p>
              <Button variant="destructive" size="sm" onClick={requestDelete}>
                {t("deleteTitle")}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("retention")}</p>
        </CardContent>
      </Card>

      <ConfirmationDialog dialog={confirmDialog} />
    </div>
  );
}

export default SettingsSecurity;
