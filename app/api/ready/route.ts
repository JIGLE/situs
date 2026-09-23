import { NextResponse } from "next/server";

export const runtime = "nodejs";

const HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * Lightweight readiness probe.
 *
 * Returns HTTP 200 as soon as the Node.js process can serve requests and never touches the
 * database. The Docker HEALTHCHECK polls it, so a healthy container means the server is up, not
 * that the database answers.
 *
 * For a probe that includes the database, use /api/monitoring/health — it runs `SELECT 1` and,
 * like this route, needs no session. /api/health also checks the database but answers only a
 * signed-in owner, so a probe pointed at it always fails.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    { status: 200, headers: HEADERS },
  );
}

/** HEAD handler — needed for wget --spider and some K8s probes. */
export async function HEAD(): Promise<NextResponse> {
  return new NextResponse(null, { status: 200, headers: HEADERS });
}
