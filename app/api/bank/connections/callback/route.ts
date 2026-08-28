import { NextRequest, NextResponse } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { completeConsent, ConsentFlowError } from "@/lib/services/bank/consent";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";

/**
 * GET /api/bank/connections/callback?state=… — where the bank sends the user back.
 *
 * This is a browser redirect, not an API call, so it answers with a redirect rather than JSON:
 * the person arriving here is looking at a page, and a JSON body would strand them on it.
 *
 * It carries the session cookie like any other navigation, which is what lets it be authenticated
 * at all. The guards that matter live in `completeConsent` — unguessable reference, must belong to
 * the signed-in user, single-use — and are tested there.
 *
 * ── The Location is RELATIVE, deliberately ────────────────────────────────────────────────────
 * This used to build `new URL(path, request.nextUrl.origin)`. In the standalone server that origin
 * is reconstructed from HOSTNAME/PORT and forwarded headers, so behind a reverse proxy it came out
 * as `https://0.0.0.0:3000` — the container's BIND address, which no browser can connect to. The
 * consent had completed; only the last hop was unreachable, which is the worst place to fail.
 *
 * A relative reference cannot be wrong: the browser resolves it against the URL it actually
 * requested, so the operator lands back on whatever host they were using — LAN address, hostname,
 * reverse proxy, tunnel — with no dependency on env vars or headers. RFC 7231 §7.1.2 allows it.
 *
 * `NextResponse.redirect()` insists on an absolute URL, hence the explicit header. 303 because the
 * flow has been processed and what follows is a plain GET of a different resource.
 */
async function handleGet(request: NextRequest): Promise<Response> {
  const seeOther = (path: string) =>
    new NextResponse(null, { status: 303, headers: { Location: path } });

  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  // `state` first: it is the standard name for the value a redirect flow echoes back, and it is
  // what we put our nonce in. `ref` stays as a fallback for a provider that names it that way.
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const reference = params.state ?? params.ref ?? "";

  try {
    // Everything the redirect carried goes through. This route used to read one parameter and
    // discard the rest, which silently ruled out any provider whose consent completes by
    // exchanging a single-use `code` that only exists here.
    const { isTest } = await completeConsent(scopeUserId, reference, params);

    // Back where it was started from. A test connection is begun in the control center and is
    // managed there, so finishing on the Settings tab would strand the operator away from the
    // panel that lists it and offers to delete it.
    return seeOther(isTest ? "/admin?bank=connected" : "/settings?tab=integrations&bank=connected");
  } catch (error) {
    // The reason is deliberately not put in the URL: these messages are the same for an unknown,
    // a replayed and a foreign reference precisely so the redirect cannot be used as an oracle.
    // The user sees "that did not complete"; the log carries the detail.
    //
    // A failure cannot know whether the connection was a test — resolving which one it was is the
    // very thing that just failed — so it lands on Settings, where every connection is listed.
    logger.warn("Bank consent callback did not complete", {
      error: error instanceof Error ? error.message : String(error),
      status: error instanceof ConsentFlowError ? error.status : 500,
    });
    return seeOther("/settings?tab=integrations&bank=failed");
  }
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
