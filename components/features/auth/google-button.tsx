"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";

function GoogleGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

/**
 * The one way in. It wears Google's own button styles (white on a light page, near-black on a dark
 * one, `--google-button-*`), is 52px tall, and answers a tap at once: the redirect to Google takes
 * a moment on a phone, and a button that does nothing visible gets tapped twice.
 *
 * Coming back with the browser's Back button restores the page from its cache with the button
 * still busy, so a restored page puts it right.
 */
export function GoogleButton({
  label,
  destination,
  className,
}: {
  label: string;
  destination: string;
  className?: string;
}): React.ReactElement {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  return (
    <Button
      type="button"
      variant="ghost"
      loading={pending}
      aria-busy={pending}
      onClick={() => {
        setPending(true);
        void signIn("google", { callbackUrl: destination }).catch(() => setPending(false));
      }}
      className={cn(
        "h-[52px] w-full gap-3 border border-[var(--google-button-border)] bg-[var(--google-button-bg)] text-reading font-medium text-[var(--google-button-fg)] hover:bg-[var(--google-button-bg)] hover:text-[var(--google-button-fg)] hover:opacity-90",
        className,
      )}
    >
      {!pending && <GoogleGlyph />}
      {label}
    </Button>
  );
}
