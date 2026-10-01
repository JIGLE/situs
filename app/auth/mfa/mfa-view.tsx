"use client";

import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeyRound, ShieldCheck } from "lucide-react";
import { LanguageSelector } from "@/components/shared/language-selector";
import { SitusPortalMark } from "@/components/shared/situs-portal-logo";
import { Button } from "@/components/ui/button";

/** What the screen says when a code is not accepted, by the status the server answered. */
type Problem = "invalid" | "tooMany" | "generic";

const problemOf = (status: number): Problem =>
  status === 429 ? "tooMany" : status === 400 ? "invalid" : "generic";

/**
 * The second step of signing in, for an account with an authenticator app.
 *
 * The proxy sends a session that has passed the first factor here, and refuses it everywhere else
 * until its code is verified (`proxy.ts`, `requireAuth`). The code goes to
 * `/api/auth/totp/verify`, which records the verification on the account; refreshing the session
 * is what clears `mfaPending` on this one (`lib/services/auth/auth.ts`).
 *
 * The server's answer is never shown: its words are English, so the screen says its own by status.
 */
export function MfaView() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const t = useTranslations("auth.mfa");
  const tAuth = useTranslations("auth");

  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pending = (session as { mfaPending?: boolean } | null)?.mfaPending === true;

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/auth/signin");
    // Nothing waits for a second factor, so there is nothing to do here.
    if (status === "authenticated" && !pending) router.replace("/dashboard");
  }, [status, pending, router]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [useBackup, status]);

  const length = useBackup ? 8 : 6;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || code.length < length) return;

    setSubmitting(true);
    setProblem(null);
    try {
      const res = await fetch("/api/auth/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        await update();
        router.replace("/dashboard");
        return;
      }
      setProblem(problemOf(res.status));
      setCode("");
    } catch {
      setProblem("generic");
    } finally {
      setSubmitting(false);
    }
  }

  if (status !== "authenticated" || !pending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
        <div className="flex items-center gap-3 text-[var(--color-muted-foreground)]">
          <SitusPortalMark className="h-6 w-6 motion-safe:animate-pulse" />
          <span className="text-sm">{tAuth("loading")}</span>
        </div>
      </div>
    );
  }

  const Icon = useBackup ? KeyRound : ShieldCheck;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-5 py-12 sm:px-10">
      <div className="w-full max-w-sm motion-safe:animate-fade-in">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <SitusPortalMark className="h-10 w-10" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.22em]">Situs</span>
          </div>
          <LanguageSelector />
        </div>

        <p className="mono-label mb-3 flex items-center gap-2">
          <Icon className="h-4 w-4" aria-hidden />
          {t("eyebrow")}
        </p>
        <h1 className="text-[clamp(26px,4vw,34px)] font-normal leading-tight tracking-[-0.03em] text-[var(--color-foreground)]">
          {t("heading")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
          {useBackup ? t("subheadingBackup") : t("subheadingApp")}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-3">
          <div>
            <label htmlFor="mfa-code" className="mono-label-xs mb-1.5 block">
              {useBackup ? t("backupLabel") : t("codeLabel")}
            </label>
            <input
              ref={inputRef}
              id="mfa-code"
              name="code"
              type="text"
              inputMode={useBackup ? "text" : "numeric"}
              autoComplete="one-time-code"
              spellCheck={false}
              maxLength={length}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\s/g, ""))}
              aria-invalid={problem === "invalid"}
              aria-describedby={problem ? "mfa-problem" : undefined}
              placeholder={useBackup ? "XXXXXXXX" : "000000"}
              className="w-full border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-center font-mono text-lg tracking-[0.3em] text-[var(--color-foreground)] outline-none transition-colors placeholder:text-[var(--color-muted-foreground)] focus:border-[var(--country-highlight-readable)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            />
          </div>

          {problem && (
            <p
              id="mfa-problem"
              role="alert"
              className="text-center text-sm text-[var(--semantic-danger-readable)]"
            >
              {t(`errors.${problem}`)}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting || code.length < length}
            className="h-11 w-full bg-[var(--color-primary)] font-semibold text-[var(--color-primary-foreground)] hover:opacity-90"
          >
            {submitting ? t("verifying") : t("verify")}
          </Button>
        </form>

        <div className="mt-8 flex flex-col items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => {
              setUseBackup((value) => !value);
              setCode("");
              setProblem(null);
            }}
            className="inline-flex items-center justify-center font-medium text-[var(--country-highlight-readable)] underline-offset-4 hover:underline max-md:min-h-11 max-md:min-w-11"
          >
            {useBackup ? t("useApp") : t("useBackup")}
          </button>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            className="inline-flex items-center justify-center text-[var(--color-muted-foreground)] underline-offset-4 hover:underline max-md:min-h-11 max-md:min-w-11"
          >
            {t("signOut")}
          </button>
        </div>
      </div>
    </div>
  );
}
