import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";

import { getAuthOptions } from "@/lib/services/auth/auth";

// next-auth/jwt's typings reference next's GetServerSidePropsContext, which does not resolve under
// moduleResolution:bundler: it is loaded by value and typed by hand, as proxy.ts does.
const { getToken } = require("next-auth/jwt") as {
  getToken: (params: {
    req: NextRequest;
    secret?: string;
  }) => Promise<Record<string, unknown> | null>;
};

export type PendingSession =
  | { ok: true; userId: string; sid: string }
  | { ok: false; status: 401 | 409; error: string; reason?: string };

/**
 * The session that is waiting for its second factor: who it is and its own name.
 *
 * `requireAuth` refuses exactly this session (`mfaPending`), so the routes that let one finish
 * signing in read it here instead, as `totp/verify` does. They answer only a correct second factor
 * for THIS session, never anything else: a session that is not waiting is refused, so a signed-in
 * session cannot use them, and one that has no name yet is told to refresh first.
 */
export async function pendingSession(request: NextRequest): Promise<PendingSession> {
  const session = await getServerSession(
    getAuthOptions() as Parameters<typeof getServerSession>[0],
  );
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, status: 401, error: "Not authenticated" };

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (token?.mfaPending !== true) {
    return {
      ok: false,
      status: 409,
      error: "No code is waiting on this session",
      reason: "mfa_not_pending",
    };
  }
  // A pending session gets its name at its next refresh if it has none yet, which the code page
  // causes by reading the session, so this is only a request that raced it.
  const sid = typeof token.sid === "string" ? token.sid : null;
  if (!sid) {
    return {
      ok: false,
      status: 401,
      error: "This sign-in has to be refreshed first",
      reason: "mfa_session_unnamed",
    };
  }
  return { ok: true, userId, sid };
}
