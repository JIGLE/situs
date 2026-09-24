import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createSuccessResponse,
  Logger,
  parseJsonBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { contractImportSchema } from "@/lib/services/contracts/schema";
import { importContract } from "@/lib/services/contracts/import";

/**
 * Write a contract the owner has reviewed and confirmed (lib/services/contracts/import.ts).
 *
 * The body is the review, not the reading: every value in it is one the owner saw, and the
 * schema holds it to the rules the sheet showed (dates in order, shares that make 100%, NIFs that
 * check). Unlike reading, this needs no Anthropic key: it calls no one, and a review should not be
 * lost because the key went away while it was open.
 */

async function handlePost(request: NextRequest): Promise<Response> {
  const access = await requireOwnerAccess(request);
  if (access instanceof Response) return access;

  const review = await parseJsonBody(request, contractImportSchema);

  try {
    return createSuccessResponse(await importContract(access.userId, review), 201);
  } catch (error) {
    // Tenant and owner emails are unique across the instance. Named, so the sheet can say which.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      Logger.warn("Contract import refused: email in use", { target: error.meta?.target });
      return NextResponse.json(
        { error: "A tenant or owner with that email already exists", reason: "email_taken" },
        { status: 409 },
      );
    }
    throw error;
  }
}

export const POST = withErrorHandler(withRateLimit(handlePost));
