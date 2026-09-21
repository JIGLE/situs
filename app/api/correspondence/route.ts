import { NextRequest } from "next/server";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { correspondenceService } from "@/lib/services/database/correspondence";
import { z } from "zod";

// Validation schema for updates
const updateCorrespondenceSchema = z.object({
  status: z.enum(["draft", "sent", "delivered"]).optional(),
  sentAt: z.string().datetime().optional(),
});

// GET /api/correspondence - Get all correspondence for the authenticated user
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;

  try {
    const correspondence = await correspondenceService.getAll(userId);
    return createSuccessResponse(correspondence);
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

// PUT /api/correspondence/[id] - Update correspondence status
async function handlePut(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  let id: string | undefined;
  if (context?.params) {
    const maybe = context.params as Record<string, string> | Promise<Record<string, string>>;
    const resolved = maybe instanceof Promise ? await maybe : maybe;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  try {
    // First check if correspondence exists and user owns it
    const existingCorrespondence = await correspondenceService.getById(userId, id);
    if (!existingCorrespondence) {
      return createErrorResponse(new Error("Correspondence not found"), 404, request);
    }

    const body = await request.json();

    // Validate input
    const validatedData = updateCorrespondenceSchema.parse(body);

    const correspondence = await correspondenceService.update(userId, id, validatedData);
    return createSuccessResponse(correspondence);
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

// Main handler
export const GET = withErrorHandler(handleGet);
export const PUT = withErrorHandler(handlePut);
export const OPTIONS = handleOptions;
