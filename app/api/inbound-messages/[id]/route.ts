import { NextRequest } from "next/server";
import { z } from "zod";

import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { getPrismaClient } from "@/lib/services/database/database";
import { assertOwnsRelations } from "@/lib/services/database/assert-owned";
import { logAudit } from "@/lib/services/audit-log";

type RouteContext = { params?: Record<string, string> | Promise<Record<string, string>> };

// withErrorHandler's generic signature takes an optional context, so a handler declaring it
// required fails variance-checking — matching the same params/context shape
// app/api/documents/[id]/route.ts and app/api/maintenance/[id]/route.ts already use.
async function routeId(context?: RouteContext): Promise<string> {
  const params = context?.params
    ? context.params instanceof Promise
      ? await context.params
      : context.params
    : {};
  return params.id || "";
}

// null clears the link; omitted leaves it as-is — the same three-state shape UpdateDocumentData
// uses for its own nullable relations.
const updateSchema = z.object({
  tenantId: z.string().min(1).max(100).nullable().optional(),
  archived: z.boolean().optional(),
  read: z.boolean().optional(),
});

// GET /api/inbound-messages/[id] — full message, for the Inbox detail panel
async function handleGet(request: NextRequest, context?: RouteContext): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const id = await routeId(context);
  if (!id) return createErrorResponse(new Error("Message ID is required"), 400, request);

  try {
    const prisma = getPrismaClient();
    const message = await prisma.inboundMessage.findFirst({
      where: { id, userId },
      include: {
        tenant: { select: { id: true, name: true } },
        property: { select: { id: true, name: true } },
        attachments: {
          select: { id: true, filename: true, mimeType: true, fileSize: true, documentId: true },
        },
      },
    });
    if (!message) {
      return createErrorResponse(new Error("Message not found"), 404, request);
    }

    // See the note in the list route: suggestedTenantId has no Prisma relation on purpose.
    const suggestedTenant = message.suggestedTenantId
      ? await prisma.tenant.findFirst({
          where: { id: message.suggestedTenantId, userId },
          select: { id: true, name: true },
        })
      : null;

    return createSuccessResponse({
      id: message.id,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      toAddress: message.toAddress,
      subject: message.subject,
      textBody: message.textBody,
      receivedAt: message.receivedAt.toISOString(),
      read: message.read,
      archived: message.archived,
      spfResult: message.spfResult,
      dkimResult: message.dkimResult,
      suggestedTenantId: message.suggestedTenantId,
      suggestedTenantName: suggestedTenant?.name ?? null,
      tenantId: message.tenantId,
      tenantName: message.tenant?.name ?? null,
      propertyId: message.propertyId,
      propertyName: message.property?.name ?? null,
      attachments: message.attachments,
    });
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

// PUT /api/inbound-messages/[id] — confirm/change the tenant link, archive, or mark read
async function handlePut(request: NextRequest, context?: RouteContext): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const id = await routeId(context);
  if (!id) return createErrorResponse(new Error("Message ID is required"), 400, request);

  try {
    const prisma = getPrismaClient();
    const existing = await prisma.inboundMessage.findFirst({
      where: { id, userId },
      select: { id: true, tenantId: true },
    });
    if (!existing) {
      return createErrorResponse(new Error("Message not found"), 404, request);
    }

    const body = await request.json();
    const data = updateSchema.parse(body);

    const updateData: {
      tenantId?: string | null;
      propertyId?: string | null;
      archived?: boolean;
      read?: boolean;
    } = {};

    if ("tenantId" in data) {
      if (data.tenantId) {
        // 404s if this tenant isn't the caller's own — a session proves who is logged in, never
        // that the id they sent belongs to them. See the note on assertOwnsRelations.
        await assertOwnsRelations(userId, { tenantId: data.tenantId });
        const tenant = await prisma.tenant.findFirst({
          where: { id: data.tenantId, userId },
          select: { propertyId: true },
        });
        updateData.tenantId = data.tenantId;
        updateData.propertyId = tenant?.propertyId ?? null;
      } else {
        updateData.tenantId = null;
        updateData.propertyId = null;
      }
    }
    if (typeof data.archived === "boolean") updateData.archived = data.archived;
    if (typeof data.read === "boolean") updateData.read = data.read;

    const updated = await prisma.inboundMessage.update({
      where: { id },
      data: updateData,
    });

    // Logged here, not on receipt (see the note on InboundMessage): this is the human decision
    // that turns a claim in the From header into part of a tenant's record.
    if ("tenantId" in data) {
      await logAudit({
        userId,
        action: "LINK_INBOUND_MESSAGE",
        resourceType: "InboundMessage",
        resourceId: id,
        details: { previousTenantId: existing.tenantId, tenantId: updateData.tenantId ?? null },
      });
    }

    return createSuccessResponse({
      id: updated.id,
      tenantId: updated.tenantId,
      propertyId: updated.propertyId,
      archived: updated.archived,
      read: updated.read,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse(
        new Error(`Validation error: ${error.issues.map((e) => e.message).join(", ")}`),
        400,
        request,
      );
    }
    return createErrorResponse(error as Error, 500, request);
  }
}

export const GET = withErrorHandler(handleGet);
export const PUT = withErrorHandler(handlePut);
export const OPTIONS = handleOptions;
