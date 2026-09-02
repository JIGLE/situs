import { NextResponse } from "next/server";

import { readSmtpConfig } from "@/lib/services/email/transport";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    // Provider-agnostic: the app sends over SMTP, so what matters is a reachable host and a
    // sender address, not which vendor is behind it.
    const smtp = readSmtpConfig();
    const fromEmail = process.env.FROM_EMAIL;

    const hasSmtp = smtp !== null;
    const hasFromEmail = !!fromEmail && fromEmail.includes("@");
    const isConfigured = hasSmtp && hasFromEmail;

    if (!isConfigured) {
      return NextResponse.json(
        {
          status: "degraded",
          timestamp: new Date().toISOString(),
          provider: "smtp",
          configured: false,
          issues: [
            !hasSmtp && "Missing SMTP_HOST",
            !hasFromEmail && "Missing or invalid FROM_EMAIL",
          ].filter(Boolean),
          response_time_ms: Date.now() - startTime,
        },
        { status: 200 }, // Return 200 but mark as degraded (non-blocking)
      );
    }

    // Configuration is valid
    return NextResponse.json(
      {
        status: "healthy",
        timestamp: new Date().toISOString(),
        provider: "smtp",
        // The host, never the credentials: this endpoint is unauthenticated so an uptime
        // checker can reach it.
        host: smtp?.host,
        configured: true,
        from_email: fromEmail,
        response_time_ms: Date.now() - startTime,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      },
    );
  } catch (error) {
    console.error(
      "Email health check failed:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        // Unauthenticated and ungated, same as /api/health/db. A SendGrid failure message can
        // carry the API key prefix and account identifiers, so production gets the generic form.
        error:
          process.env.NODE_ENV === "production"
            ? "email service error"
            : error instanceof Error
              ? error.message
              : "Unknown email service error",
        response_time_ms: Date.now() - startTime,
      },
      { status: 503 },
    );
  }
}
