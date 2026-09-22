import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getAuthOptions } from "@/lib/services/auth/auth";
import { isMockMode } from "@/lib/config/data-mode";
import { isDevAuthEnabled } from "@/lib/services/auth/dev-session";
import { isOwnerSessionRole } from "@/lib/portal/access";

// Authentication middleware for API routes
export async function requireAuth(_request: NextRequest): Promise<
  | {
      session: Session;
      userId: string;
    }
  | NextResponse
> {
  try {
    // Import next-auth lazily so tests can mock getServerSession before we call it
    const mod = await import("next-auth/next").catch(() => import("next-auth"));
    type GetServerSession = (opts?: ReturnType<typeof getAuthOptions>) => Promise<Session | null>;
    const maybe = mod as { getServerSession?: GetServerSession };
    const getServerSession = maybe.getServerSession;

    // Call getServerSession at runtime (not module load time) so tests can stub it
    const session = (await getServerSession?.(getAuthOptions())) ?? null;

    if (!session) {
      return new NextResponse(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // In dev auth mode, use session data directly without database lookup
    if (isDevAuthEnabled()) {
      const userId = session.user?.id || session.user?.email || "dev-user";
      return { session, userId };
    }

    // In mock mode, use session data directly without database lookup
    if (isMockMode) {
      // Use email hash or session.user.id as a stable userId in mock mode
      const userId = session.user?.id || session.user?.email || "mock-user";
      return { session, userId };
    }

    // Prefer session user id when present to avoid unnecessary DB lookups on every request.
    if (session.user?.id) {
      return { session, userId: session.user.id };
    }

    // Fallback for session shapes that only contain email.
    if (session.user?.email) {
      // Find user in database — separate DB errors from "not found"
      let user;
      try {
        const { getPrismaClient } = await import("@/lib/services/database/database");
        const prisma = getPrismaClient();
        user = await prisma.user.findUnique({
          where: { email: session.user.email },
        });
      } catch (dbError: unknown) {
        const msg = dbError instanceof Error ? dbError.message : String(dbError);
        console.error("requireAuth: database error during user lookup:", msg);

        if (msg.includes("no such table") || msg.includes("SQLITE_ERROR")) {
          console.error(
            "HINT: The database exists but has no tables. " +
              "Run database initialization: POST /api/debug/db/init " +
              "or exec into the container and run: npx prisma db push --schema=prisma/schema.prisma",
          );
        }

        return new NextResponse(
          JSON.stringify({
            error: "Service temporarily unavailable",
            detail: "Database connection error",
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (!user) {
        // Do not auto-create users — they must register via a proper auth flow
        return new NextResponse(
          JSON.stringify({
            error: "User account not found. Please sign up or contact an administrator.",
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return { session, userId: user.id };
    }

    return new NextResponse(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errName = error instanceof Error ? error.name : "UnknownError";
    console.error("requireAuth error:", errName, errMsg);

    // Distinguish database errors from auth errors
    const isDbError =
      errMsg.includes("no such table") ||
      errMsg.includes("SQLITE_ERROR") ||
      errMsg.includes("SQLite DB file") ||
      errMsg.includes("Prisma") ||
      errMsg.includes("database") ||
      errMsg.includes("not writable") ||
      errMsg.includes("does not exist");

    if (isDbError) {
      if (errMsg.includes("no such table") || errMsg.includes("SQLITE_ERROR")) {
        console.error(
          "HINT: The database exists but has no tables. " +
            "Run database initialization: POST /api/debug/db/init " +
            "or exec into the container and run: npx prisma db push --schema=prisma/schema.prisma",
        );
      }
      return new NextResponse(
        JSON.stringify({
          error: "Service temporarily unavailable",
          detail: "Database connection error",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new NextResponse(
      JSON.stringify({
        error: "Authentication failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// Authorization middleware for resource ownership
export async function requireOwnership(
  request: NextRequest,
  resourceUserId: string,
): Promise<void | NextResponse> {
  const authResult = await requireAuth(request);

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { userId } = authResult;

  if (userId !== resourceUserId) {
    return new NextResponse(JSON.stringify({ error: "Access denied" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export interface AccessContext {
  session: Session;
  userId: string;
  scopeUserId: string;
}

/**
 * The signed-in owner, and the user id their data is scoped to.
 *
 * This used to fork: an owner got their own id, and a role=USER session was resolved to the
 * Tenant row matching their email so `scopeUserId` became their LANDLORD's id, giving a
 * tenant a narrow read of someone else's data. The scope cutdown removed tenant access to
 * this app, so the fork is gone and `scopeUserId` is always the caller's own id — the
 * routes that used to narrow their queries by `portalRole === "tenant"` no longer can.
 *
 * A USER-role session is refused rather than quietly promoted to owner.
 */
export async function getAccessContext(
  request: NextRequest,
): Promise<AccessContext | NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { session, userId } = authResult;

  if (!isOwnerSessionRole(session.user.role)) {
    return new NextResponse(JSON.stringify({ error: "Forbidden: Owner access required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { session, userId, scopeUserId: userId };
}

// CORS headers for API responses
export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": process.env.NEXTAUTH_URL || "http://localhost:3000",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

// Handle OPTIONS requests for CORS
export function handleOptions(): NextResponse {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders(),
  });
}

export async function requireAdmin(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }
  const { session } = authResult;
  if (session.user.role !== "ADMIN") {
    return new NextResponse(JSON.stringify({ error: "Forbidden: Admin access required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return authResult;
}

/**
 * Kept as the name call sites use. `getAccessContext` now refuses a non-owner itself, so
 * this is an alias rather than a second gate — re-checking would be a branch that cannot
 * be taken, which reads as a guard and is not one.
 */
export async function requireOwnerAccess(request: NextRequest) {
  return getAccessContext(request);
}
