import { NextRequest, NextResponse } from "next/server";
import { getPrismaClient } from "@/lib/services/database/database";
import { isMockMode } from "@/lib/config/data-mode";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPortalRoleFromSessionRole } from "@/lib/portal/access";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { session } = authResult;
  if (getPortalRoleFromSessionRole(session.user.role) !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const startTime = Date.now();

  try {
    // In mock mode, return minimal health check
    if (isMockMode) {
      return NextResponse.json(
        {
          status: "ok",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          environment: "development (mock)",
          checks: {
            database: {
              status: "mock",
              latency_ms: 0,
            },
            email: {
              status: "mock",
              provider: "none",
            },
          },
          response_time_ms: Date.now() - startTime,
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        },
      );
    }
    // Test database connectivity
    const prisma = getPrismaClient();
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatency = Date.now() - dbStart;

    // Check email service configuration
    const emailConfigured = !!(process.env.SMTP_HOST && process.env.FROM_EMAIL);

    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
        checks: {
          database: {
            status: "healthy",
            latency_ms: dbLatency,
          },
          email: {
            status: emailConfigured ? "configured" : "not_configured",
            provider: "smtp",
          },
        },
        response_time_ms: Date.now() - startTime,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Health check failed:", errMsg);

    // Database connectivity failed — report unhealthy. Operators should run
    // the init Job or POST /api/debug/db/init to initialize the schema.
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        checks: {
          database: {
            status: "unhealthy",
            error: errMsg,
          },
        },
        response_time_ms: Date.now() - startTime,
      },
      { status: 503 },
    );
  }
}
