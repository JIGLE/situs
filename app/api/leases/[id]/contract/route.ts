import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { decryptFile, encryptFile } from "@/lib/utils/pii-encryption";
import { MAX_CONTRACT_BYTES, contractFileName } from "@/lib/utils/contract-file";

/**
 * A lease's signed contract: the PDF the owner uploaded.
 *
 * The only route that reads the bytes. The Prisma client omits `contractFile` from every other
 * lease read (lib/services/database/database.ts); the lease list used to carry every lease's
 * whole PDF, as JSON the browser then turned into an empty download.
 *
 * Stored encrypted with the PII key, since the PDF carries the same NIFs `PII_FIELDS` encrypts
 * in their own columns. A contract stored before encryption is served as it is.
 *
 * The upload's body is the PDF itself, `Content-Type: application/pdf`, with the file's name
 * URI-encoded in `X-File-Name`. It used to travel inside JSON as an array of numbers, about four
 * times the file's size.
 */

const PDF_SIGNATURE = Buffer.from("%PDF-");

type Context = { params?: Record<string, string> | Promise<Record<string, string>> };

async function leaseIdFrom(context?: Context): Promise<string | undefined> {
  if (!context?.params) return undefined;
  const params = context.params instanceof Promise ? await context.params : context.params;
  return params?.id;
}

/** `attachment`, with an ASCII fallback name and the real one per RFC 5987. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function handlePut(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const id = await leaseIdFrom(context);
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  // Refused before the body is read when the request says it is too large.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_CONTRACT_BYTES) {
    return createErrorResponse(new Error("Contract file too large"), 413, request);
  }

  const prisma = getPrismaClient();
  const lease = await prisma.lease.findFirst({ where: { id, userId }, select: { id: true } });
  if (!lease) return createErrorResponse(new Error("Lease not found"), 404, request);

  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length > MAX_CONTRACT_BYTES) {
    return createErrorResponse(new Error("Contract file too large"), 413, request);
  }
  // The file's own first bytes, not the Content-Type the client chose to send.
  if (!bytes.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    return createErrorResponse(new Error("Contract must be a PDF"), 415, request);
  }

  const name = contractFileName(request.headers.get("x-file-name"), id);
  await prisma.lease.update({
    where: { id, userId },
    // Copied into a Uint8Array over a plain ArrayBuffer, the type Prisma 7 takes for `Bytes`.
    data: {
      contractFile: new Uint8Array(encryptFile(bytes)),
      contractFileName: name,
      contractFileSize: bytes.length,
    },
  });
  await logAudit({
    userId,
    action: "UPLOAD_LEASE_CONTRACT",
    resourceType: "Lease",
    resourceId: id,
    details: { size: bytes.length },
  });

  return createSuccessResponse({ contractFileName: name, contractFileSize: bytes.length });
}

async function handleGet(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const id = await leaseIdFrom(context);
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  const lease = await getPrismaClient().lease.findFirst({
    where: { id, userId },
    select: { contractFile: true, contractFileName: true },
  });
  if (!lease?.contractFile) {
    return createErrorResponse(new Error("No contract stored for this lease"), 404, request);
  }

  const bytes = decryptFile(lease.contractFile);
  // decryptFile has logged the likely cause: the key is missing or has changed.
  if (!bytes) return createErrorResponse(new Error("Contract could not be read"), 500, request);

  await logAudit({
    userId,
    action: "DOWNLOAD_LEASE_CONTRACT",
    resourceType: "Lease",
    resourceId: id,
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": contentDisposition(lease.contractFileName || `contract-${id}.pdf`),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handleDelete(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const id = await leaseIdFrom(context);
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  const prisma = getPrismaClient();
  const lease = await prisma.lease.findFirst({ where: { id, userId }, select: { id: true } });
  if (!lease) return createErrorResponse(new Error("Lease not found"), 404, request);

  await prisma.lease.update({
    where: { id, userId },
    data: { contractFile: null, contractFileName: null, contractFileSize: null },
  });
  await logAudit({
    userId,
    action: "DELETE_LEASE_CONTRACT",
    resourceType: "Lease",
    resourceId: id,
  });

  return createSuccessResponse({ contractFileName: null, contractFileSize: null });
}

export const PUT = withErrorHandler(handlePut);
export const GET = withErrorHandler(handleGet);
export const DELETE = withErrorHandler(handleDelete);
export const OPTIONS = handleOptions;
