"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, X } from "lucide-react";

/** Minimal shape of the (non-standard) beforeinstallprompt event. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "lares.pwa.install-dismissed";

/**
 * Registers the service worker and renders an unobtrusive "Install app" prompt
 * when the browser reports the app is installable (Android/Chrome, desktop
 * Chrome/Edge). Hidden once installed or dismissed.
 */
export function PwaRegister(): React.ReactElement | null {
  const t = useTranslations("pwa");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(true);

  // Register the service worker.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration is best-effort; the app works fine without it */
      });
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  // Capture the install prompt.
  useEffect(() => {
    const alreadyDismissed =
      typeof localStorage !== "undefined" && localStorage.getItem(DISMISS_KEY) === "1";

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      if (!alreadyDismissed) setDismissed(false);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setDismissed(true);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setDismissed(true);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    if (typeof localStorage !== "undefined") localStorage.setItem(DISMISS_KEY, "1");
  }, []);

  if (!deferredPrompt || dismissed) return null;

  return (
    <div
      role="dialog"
      aria-label={t("install")}
      className="fixed inset-x-3 bottom-[5.5rem] z-[var(--z-toast)] mx-auto flex max-w-sm items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3 shadow-[var(--shadow-modal)] md:inset-x-auto md:right-4 md:bottom-4 md:left-auto"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)] text-[var(--color-primary)]">
        <Download className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--color-foreground)]">{t("install")}</p>
        <p className="truncate text-xs text-[var(--color-muted-foreground)]">{t("help")}</p>
      </div>
      <button
        onClick={handleInstall}
        className="shrink-0 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-primary-foreground)] transition-[filter] hover:brightness-110"
      >
        {t("installAction")}
      </button>
      <button
        onClick={handleDismiss}
        aria-label={t("dismiss")}
        className="shrink-0 rounded-md p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
