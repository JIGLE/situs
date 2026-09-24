import { NextResponse } from "next/server";
import { timingSafeEqualString } from "@/lib/utils/security";

/**
 * The bearer check for the counter endpoint, `/api/metrics`. The proxy lets it through without a
 * session, because a scraper has none; this is what stands in front of it instead.
 *
 * The counter endpoints used to take `INIT_SECRET`, each through its own copy of this check. That
 * secret also opens `/api/debug/db/init`, so a scrape config held more than read access to
 * counters. `METRICS_TOKEN` opens nothing else.
 *
 * - Development: open, as the counters always were.
 * - Production: `Authorization: Bearer $METRICS_TOKEN`, compared in constant time.
 * - Production without `METRICS_TOKEN`: 403. Closed, as it was without `INIT_SECRET`.
 */
export function requireMetricsToken(request: Request): NextResponse | null {
  if (process.env.NODE_ENV !== "production") return null;

  const token = process.env.METRICS_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  if (token && timingSafeEqualString(authorization, `Bearer ${token}`)) return null;

  return NextResponse.json(
    { error: "Authentication required for metrics in production" },
    { status: 403 },
  );
}
