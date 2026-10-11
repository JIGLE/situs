import { redirect } from "next/navigation";

import { AuthView, type AuthMode } from "@/components/features/auth/auth-view";
import { isSignUpOpen } from "@/lib/services/auth/sign-up";
import { safeCallbackUrl } from "@/lib/utils/safe-callback-url";
import { isDemoLoginEnabled } from "@/lib/utils/demo-login";

export type AuthSearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The server half of the sign-in and sign-up pages.
 *
 * - A visitor who is already signed in never sees the form: they go on to where they were headed,
 *   or to the second-factor page when only the first factor passed (the proxy would send them
 *   there from any portal page, so this saves the hop). This used to be a client effect behind a
 *   spinner screen, which made a cold launch show two loading states before the form.
 * - Whether a visitor with no account can create one decides the wording (`isSignUpOpen`). The
 *   sign-up page of a closed instance goes to sign-in, which says it is by invitation, instead of
 *   offering to create an account that would be refused.
 * - `callbackUrl` is checked here, once, so the view only ever receives a same-site path.
 *
 * Only the session read sits in the try: `redirect()` works by throwing, and inside it the catch
 * would swallow it (see `app/[locale]/page.tsx`).
 */
export async function renderAuthPage(mode: AuthMode, searchParams: AuthSearchParams) {
  const params = await searchParams;
  const raw = Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl;
  const callbackUrl = safeCallbackUrl(raw);

  let signedIn = false;
  let mfaPending = false;
  try {
    const { getServerSession } = await import("next-auth/next");
    const { getAuthOptions } = await import("@/lib/services/auth/auth");
    const session = await getServerSession(getAuthOptions());
    signedIn = Boolean(session?.user);
    mfaPending = (session as { mfaPending?: boolean } | null)?.mfaPending === true;
  } catch {
    // An unreadable session is a signed-out visitor: the form is what they need.
  }
  if (signedIn) redirect(mfaPending ? "/auth/mfa" : (callbackUrl ?? "/dashboard"));

  const signUpOpen = await isSignUpOpen();
  if (mode === "signup" && !signUpOpen) {
    redirect(
      callbackUrl ? `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/auth/signin",
    );
  }

  return (
    <AuthView
      mode={mode}
      demoLoginEnabled={isDemoLoginEnabled()}
      signUpOpen={signUpOpen}
      callbackUrl={callbackUrl}
    />
  );
}
