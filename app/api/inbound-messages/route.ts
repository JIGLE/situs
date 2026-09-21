import { NextRequest } from "next/server";

import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { getPrismaClient } from "@/lib/services/database/database";

/** Plain-text preview shown in the list; the full body is only fetched on open. */
const SNIPPET_LENGTH = 200;

// GET /api/inbound-messages — the Correspondence Inbox list
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get("unread") === "true";
  const includeArchived = searchParams.get("archived") === "true";
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

  try {
    const prisma = getPrismaClient();
    const where = {
      userId,
      ...(includeArchived ? {} : { archived: false }),
      ...(unreadOnly ? { read: false } : {}),
    };

    const [rows, total, unreadCount] = await Promise.all([
      prisma.inboundMessage.findMany({
        where,
        orderBy: { receivedAt: "desc" as const },
        take: limit,
        skip: offset,
        include: {
          tenant: { select: { id: true, name: true } },
          _count: { select: { attachments: true } },
        },
      }),
      prisma.inboundMessage.count({ where }),
      prisma.inboundMessage.count({ where: { userId, archived: false, read: false } }),
    ]);

    // suggestedTenantId carries no Prisma relation, deliberately (see the note on the model) —
    // a suggestion may point at a tenant that no longer exists, and a foreign key would turn
    // that ordinary case into a write failure. Resolved here as a separate, best-effort lookup.
    const suggestedIds = [
      ...new Set(rows.map((m) => m.suggestedTenantId).filter((id): id is string => Boolean(id))),
    ];
    const suggestedTenants = suggestedIds.length
      ? await prisma.tenant.findMany({
          where: { id: { in: suggestedIds }, userId },
          select: { id: true, name: true },
        })
      : [];
    const suggestedNameById = new Map(suggestedTenants.map((t) => [t.id, t.name]));

    const messages = rows.map((m) => ({
      id: m.id,
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      subject: m.subject,
      snippet: m.textBody.slice(0, SNIPPET_LENGTH),
      read: m.read,
      archived: m.archived,
      receivedAt: m.receivedAt.toISOString(),
      spfResult: m.spfResult,
      dkimResult: m.dkimResult,
      suggestedTenantId: m.suggestedTenantId,
      suggestedTenantName: m.suggestedTenantId
        ? (suggestedNameById.get(m.suggestedTenantId) ?? null)
        : null,
      tenantId: m.tenantId,
      tenantName: m.tenant?.name ?? null,
      attachmentCount: m._count.attachments,
    }));

    return createSuccessResponse({ messages, total, unreadCount });
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

export const GET = withErrorHandler(handleGet);
export const OPTIONS = handleOptions;
