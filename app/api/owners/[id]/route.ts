import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { assertOwnerHasNoHistory } from "@/lib/services/database/history";
import { refuseDuplicateEmail } from "@/lib/services/database/unique-email";
import { blankToNull, normalizeTaxId } from "@/lib/schemas/tax-identity";
import { updateOwnerSchema } from "@/lib/schemas/owner.schema";
import {
  ResourceNotFoundError,
  ValidationError,
  createSuccessResponse,
  parseBody,
  readJson,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

/**
 * One owner: the edit screen's save and delete.
 *
 * Both used to call this route and find nothing: the collection had a GET and a POST, so an owner
 * could be created and never changed or removed, and nothing anywhere stored the NIF that AT names
 * a landlord by on a receipt.
 */

type Context = { params?: Record<string, string> | Promise<Record<string, string>> };

async function idOf(context?: Context): Promise<string> {
  const params = context?.params instanceof Promise ? await context.params : context?.params;
  if (!params?.id) throw new ValidationError("Invalid request: missing id");
  return params.id;
}

// What GET /api/owners returns, so a save answers with the record the list holds.
const ownerInclude = { properties: { include: { property: true } } } as const;

async function handlePut(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const id = await idOf(context);
  const prisma = getPrismaClient();
  const existing = await prisma.owner.findFirst({ where: { id, userId: scopeUserId } });
  if (!existing) throw new ResourceNotFoundError("Owner", id);

  const { taxIdentificationNumber, ...fields } = parseBody(
    await readJson(request),
    updateOwnerSchema,
  );

  const owner = await refuseDuplicateEmail("owner", () =>
    prisma.owner.update({
      where: { id },
      data: {
        ...fields,
        // Undefined leaves them as they are; a blank clears them to NULL.
        email: blankToNull(fields.email),
        phone: blankToNull(fields.phone),
        // A blank clears it, and a NIF is stored as its nine digits, as a tenant's is.
        ...(taxIdentificationNumber !== undefined && {
          taxIdentificationNumber: normalizeTaxId(taxIdentificationNumber, "PT"),
        }),
      },
      include: ownerInclude,
    }),
  );

  return createSuccessResponse(owner);
}

async function handleDelete(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const id = await idOf(context);
  const prisma = getPrismaClient();
  const existing = await prisma.owner.findFirst({ where: { id, userId: scopeUserId } });
  if (!existing) throw new ResourceNotFoundError("Owner", id);

  // A landlord of a property, or with income shares, is kept: both cascade from the owner.
  await assertOwnerHasNoHistory(scopeUserId, id);
  await prisma.owner.delete({ where: { id } });

  return createSuccessResponse({ message: "Owner deleted successfully" });
}

export const PUT = withErrorHandler(withRateLimit(handlePut));
export const DELETE = withErrorHandler(withRateLimit(handleDelete));
export const OPTIONS = handleOptions;
