import { NextRequest } from "next/server";
import { readFile } from "fs/promises";

import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { getPrismaClient } from "@/lib/services/database/database";
import { documentService } from "@/lib/services/document-service";

type RouteContext = { params?: Record<string, string> | Promise<Record<string, string>> };

/**
 * POST /api/inbound-attachments/[id]/save — file an inbound email attachment into Documents.
 *
 * The attachment row is the original and is untouched; this creates the Document copy the user
 * chose to keep, inheriting whatever tenant/property the message is linked to. Anyone who learns
 * the parse address can send us a file, so this never happens automatically — see the note on
 * InboundAttachment.
 */
async function handlePost(request: NextRequest, context?: RouteContext): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const params = context?.params
    ? context.params instanceof Promise
      ? await context.params
      : context.params
    : {};
  const id = params.id || "";
  if (!id) return createErrorResponse(new Error("Attachment ID is required"), 400, request);

  try {
    const prisma = getPrismaClient();
    const attachment = await prisma.inboundAttachment.findFirst({
      where: { id, message: { userId } },
      include: { message: { select: { tenantId: true, propertyId: true } } },
    });
    if (!attachment) {
      return createErrorResponse(new Error("Attachment not found"), 404, request);
    }
    if (attachment.documentId) {
      return createErrorResponse(new Error("Attachment already saved to Documents"), 409, request);
    }

    const bytes = await readFile(attachment.storagePath);

    const document = await documentService.create(userId, {
      name: attachment.filename,
      type: "other",
      mimeType: attachment.mimeType,
      fileContent: bytes,
      tenantId: attachment.message.tenantId ?? undefined,
      propertyId: attachment.message.propertyId ?? undefined,
    });

    // Best-effort classification, same as every other document upload — see
    // app/api/documents/route.ts. The Review Required tab exists precisely because this is a
    // mock engine; it must never block the save.
    try {
      const { classifyAndPersist } = await import("@/lib/services/ocr/service");
      await classifyAndPersist(document.id);
    } catch {
      // Ignored — see above.
    }

    await prisma.inboundAttachment.update({
      where: { id },
      data: { documentId: document.id },
    });

    return createSuccessResponse({ documentId: document.id }, 201);
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

export const POST = withErrorHandler(handlePost);
export const OPTIONS = handleOptions;
