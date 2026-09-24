import { NextRequest, NextResponse } from "next/server";
import { metrics } from "@/lib/monitoring/metrics";
import { requireMetricsToken } from "@/lib/utils/metrics-auth";

const LANDING_EVENT_PREFIX = "landing.";

/**
 * GET /api/monitoring/landing
 * Returns landing-specific event counters and recent event records.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const refused = requireMetricsToken(request);
  if (refused) return refused;

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

  const counters = metrics.getCounters();
  const allMetrics = metrics.getMetrics();

  const landingCounters = Object.fromEntries(
    Object.entries(counters).filter(([name]) => name.startsWith(LANDING_EVENT_PREFIX)),
  );

  const recentLandingEvents = allMetrics
    .filter((event) => event.name.startsWith(LANDING_EVENT_PREFIX))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((event) => ({
      name: event.name,
      value: event.value,
      timestamp: event.timestamp,
      tags: event.tags ?? {},
      type: event.type,
    }));

  const summary = {
    pageViews: landingCounters["landing.page_view"] ?? 0,
    signInClicks: landingCounters["landing.signin_click"] ?? 0,
    workflowCtaClicks: landingCounters["landing.workflow_cta_click"] ?? 0,
    scrollDepthEvents: landingCounters["landing.scroll_depth"] ?? 0,
  };

  return NextResponse.json(
    {
      timestamp: new Date().toISOString(),
      summary,
      counters: landingCounters,
      recentEvents: recentLandingEvents,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
