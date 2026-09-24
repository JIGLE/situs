import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";

export const runtime = "nodejs";

/**
 * Situs TaxConnectorDashboard read model: every connector the user has
 * (country, mode/status/last submission) plus its recent submission log —
 * the explainability trail behind every AT call (Migration C).
 */
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const prisma = getPrismaClient();
  const connectors = await prisma.taxAuthorityConnector.findMany({
    where: { userId: scopeUserId },
    orderBy: { country: "asc" },
    select: {
      id: true,
      country: true,
      connectorKey: true,
      mode: true,
      status: true,
      lastSubmissionAt: true,
    },
  });

  const logs = connectors.length
    ? await prisma.taxSubmissionLog.findMany({
        where: { userId: scopeUserId, connectorId: { in: connectors.map((c) => c.id) } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          connectorId: true,
          subjectType: true,
          subjectId: true,
          action: true,
          mode: true,
          status: true,
          responseCode: true,
          createdAt: true,
        },
      })
    : [];

  return createSuccessResponse({
    connectors,
    logs: logs.reduce<Record<string, typeof logs>>((acc, log) => {
      (acc[log.connectorId] ??= []).push(log);
      return acc;
    }, {}),
  });
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
