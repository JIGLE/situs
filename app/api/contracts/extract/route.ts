import { NextRequest, NextResponse } from "next/server";
import { requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { createSuccessResponse, Logger, withErrorHandler } from "@/lib/utils/error-handling";
import { rateLimit } from "@/lib/middleware/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { MAX_CONTRACT_BYTES, MAX_PROOF_BYTES } from "@/lib/utils/contract-file";
import {
  contractReaderConfigured,
  ContractReadError,
  getContractExtractor,
  type ContractDocument,
  type ContractReadFailure,
} from "@/lib/services/contracts/extractor";
import { matchContract } from "@/lib/services/contracts/match";

/**
 * Read a lease contract with Claude, and write nothing but the audit row.
 *
 * The body is a form with the contract PDF (`contract`), optionally AT's proof of its
 * registration (`registration`), and the app's locale (`language`). The answer is the reading and
 * the owner's records it matches; the review sheet shows both, and only a confirmed review is
 * written, by POST /api/contracts/import.
 *
 * This is where a contract leaves the instance: for Anthropic, in the United States
 * (docs/DATA_PROTECTION.md). So each call is audited, and the rate limit is tighter than the rest
 * of the API's, per owner, because each call costs money.
 *
 * GET says whether a reader is configured, for the Leases screen to show its button.
 */

const PDF_SIGNATURE = Buffer.from("%PDF-");
const LANGUAGES = new Set(["pt", "en", "es", "it"]);
const EXTRACT_LIMIT = { maxRequests: 20, windowSeconds: 60 * 60 };

/** A failure the review sheet translates by its `reason`; `error` is for the log. */
function failure(status: number, reason: string, error: string): NextResponse {
  Logger.warn("Contract reading failed", { reason, error });
  return NextResponse.json({ error, reason }, { status });
}

const STATUS_FOR: Record<ContractReadFailure, number> = {
  refused: 422,
  too_long: 422,
  unreadable: 422,
  rejected: 502,
  busy: 429,
  unavailable: 502,
};

async function readPdf(
  form: FormData,
  field: "contract" | "registration",
  maxBytes: number,
): Promise<Buffer | NextResponse | null> {
  const file = form.get(field);
  if (file === null) return null;
  if (!(file instanceof Blob)) return failure(400, "not_a_file", `${field} is not a file`);
  if (file.size > maxBytes) return failure(413, "too_large", `${field} is ${file.size} bytes`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    return failure(415, "not_pdf", `${field} is not a PDF`);
  }
  return bytes;
}

async function handleGet(request: NextRequest): Promise<Response> {
  const access = await requireOwnerAccess(request);
  if (access instanceof Response) return access;
  return createSuccessResponse({ configured: contractReaderConfigured() });
}

async function handlePost(request: NextRequest): Promise<Response> {
  const access = await requireOwnerAccess(request);
  if (access instanceof Response) return access;
  const { userId } = access;

  const limited = await rateLimit(request, {
    ...EXTRACT_LIMIT,
    identifier: () => `contract-extract:${userId}`,
  });
  if (limited) return limited;

  const extractor = await getContractExtractor();
  if (!extractor) {
    return failure(503, "not_configured", "ANTHROPIC_API_KEY is not set");
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_CONTRACT_BYTES + MAX_PROOF_BYTES + 64 * 1024) {
    return failure(413, "too_large", `Request is ${declared} bytes`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure(400, "not_a_form", "Body is not a form");
  }

  const contract = await readPdf(form, "contract", MAX_CONTRACT_BYTES);
  if (contract instanceof NextResponse) return contract;
  if (!contract) return failure(400, "no_contract", "No contract was sent");
  const registration = await readPdf(form, "registration", MAX_PROOF_BYTES);
  if (registration instanceof NextResponse) return registration;

  const documents: ContractDocument[] = [{ kind: "contract", bytes: contract }];
  if (registration) documents.push({ kind: "registration", bytes: registration });
  const language = String(form.get("language") ?? "");

  let outcome = "read";
  try {
    const reading = await extractor.extract(documents, LANGUAGES.has(language) ? language : "pt");

    const prisma = getPrismaClient();
    const [properties, owners, tenants] = await Promise.all([
      prisma.property.findMany({
        where: { userId },
        select: { id: true, address: true, cadasterReference: true, fraction: true },
      }),
      prisma.owner.findMany({
        where: { userId },
        select: { id: true, email: true, taxIdentificationNumber: true },
      }),
      prisma.tenant.findMany({
        where: { userId },
        select: { id: true, email: true, taxId: true, taxCountry: true },
      }),
    ]);

    return createSuccessResponse({
      reading,
      matches: matchContract(reading, { properties, owners, tenants }),
    });
  } catch (error) {
    if (!(error instanceof ContractReadError)) throw error;
    outcome = error.reason;
    return failure(STATUS_FOR[error.reason], error.reason, error.message);
  } finally {
    // Written whatever the outcome: the documents left the instance either way.
    await logAudit({
      userId,
      action: "EXTRACT_LEASE_CONTRACT",
      details: {
        model: extractor.model,
        documents: documents.length,
        bytes: documents.reduce((sum, d) => sum + d.bytes.length, 0),
        outcome,
      },
    });
  }
}

export const GET = withErrorHandler(handleGet);
export const POST = withErrorHandler(handlePost);
