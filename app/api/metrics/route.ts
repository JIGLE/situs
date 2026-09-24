import { NextResponse } from "next/server";
import { getPrismaClient } from "@/lib/services/database/database";
import { requireMetricsToken } from "@/lib/utils/metrics-auth";

export const runtime = "nodejs";

// In-memory metrics store. Only series that something writes belong here: three more
// (http_requests_total, http_errors_total, db_queries_total) had increment functions nothing
// called, so they reported 0 for the life of every process.
interface MetricsStore {
  email_sent_total: number;
  email_failed_total: number;
  last_reset: number;
}

// Simple in-memory metrics (resets on restart - for production use Redis or proper metrics DB)
const metrics: MetricsStore = {
  email_sent_total: 0,
  email_failed_total: 0,
  last_reset: Date.now(),
};

// Helper to format Prometheus metrics
function formatPrometheusMetrics(): string {
  const lines: string[] = [];

  lines.push("# HELP email_sent_total Automated reminder emails sent successfully");
  lines.push("# TYPE email_sent_total counter");
  lines.push(`email_sent_total ${metrics.email_sent_total}`);
  lines.push("");

  lines.push("# HELP email_failed_total Automated reminder emails that failed to send");
  lines.push("# TYPE email_failed_total counter");
  lines.push(`email_failed_total ${metrics.email_failed_total}`);
  lines.push("");

  lines.push("# HELP process_uptime_seconds Process uptime in seconds");
  lines.push("# TYPE process_uptime_seconds gauge");
  lines.push(`process_uptime_seconds ${process.uptime()}`);
  lines.push("");

  lines.push("# HELP metrics_reset_timestamp_seconds Unix timestamp of last metrics reset");
  lines.push("# TYPE metrics_reset_timestamp_seconds gauge");
  lines.push(`metrics_reset_timestamp_seconds ${Math.floor(metrics.last_reset / 1000)}`);
  lines.push("");

  return lines.join("\n");
}

export async function GET(request: Request): Promise<Response> {
  const refused = requireMetricsToken(request);
  if (refused) return refused;

  try {
    // Check if database is healthy
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;

    // Check accept header for format preference
    const acceptHeader = request.headers.get("accept") || "";
    const wantsJson = acceptHeader.includes("application/json");

    if (wantsJson) {
      // Return JSON format
      return NextResponse.json({
        metrics: {
          email_sent_total: metrics.email_sent_total,
          email_failed_total: metrics.email_failed_total,
          process_uptime_seconds: process.uptime(),
          metrics_reset_timestamp: new Date(metrics.last_reset).toISOString(),
        },
        note: "Metrics reset on application restart. For production, use persistent storage.",
      });
    } else {
      // Return Prometheus text format
      const promMetrics = formatPrometheusMetrics();
      return new Response(promMetrics, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; version=0.0.4",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }
  } catch (error) {
    console.error(
      "Metrics endpoint error:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: "Failed to retrieve metrics" }, { status: 500 });
  }
}

// Export metrics increment functions for use by other modules
export function incrementEmailSent(): void {
  metrics.email_sent_total++;
}

export function incrementEmailFailed(): void {
  metrics.email_failed_total++;
}
