import { redirect } from "next/navigation";

/**
 * `/` has no page of its own: a signed-in owner goes to the dashboard, anyone else to sign-in.
 * Situs is one owner's instance, not a product with a marketing page to show strangers.
 *
 * `proxy.ts` answers `/` with a 307 before this renders. The redirect cannot live here alone:
 * `loading.tsx` beside this page makes the response stream first, and a `redirect()` after that
 * is only a client-side meta refresh. This page is the fallback for a request the proxy misses.
 *
 * Only the session read sits in the try. `redirect()` works by throwing, and when it was inside,
 * the catch swallowed it and every signed-in visitor stayed on `/`.
 */
export default async function RootPage(): Promise<never> {
  let signedIn = false;
  try {
    const { getServerSession } = await import("next-auth/next");
    const { getAuthOptions } = await import("@/lib/services/auth/auth");
    signedIn = Boolean((await getServerSession(getAuthOptions()))?.user);
  } catch {
    // An unreadable session is a signed-out visitor: sign-in will tell them what is wrong.
  }
  redirect(signedIn ? "/dashboard" : "/auth/signin");
}
