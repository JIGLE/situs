/**
 * Fetching and storing inbound email attachments.
 *
 * Brevo does not send attachment bytes in the webhook. Each attachment arrives as a download
 * token which we exchange at `GET /v3/inbound/attachments/{token}`, authenticated with the
 * account API key. So ingesting a message with files means making outbound HTTP calls from
 * inside a webhook handler, and every limit here exists because of that.
 *
 * Three rules, each guarding a different failure:
 *
 * 1. **The URL is ours, the token is theirs.** The token is validated against a strict character
 *    class in `parse.ts` before it ever reaches this file. Interpolating an unvalidated token
 *    into a URL is how a webhook payload turns into a request for something else.
 * 2. **The bytes decide the type, not the sender.** `Content-Type` in the payload is a claim.
 *    `fileTypeFromBuffer` reads the magic bytes, and that verdict names the stored file — the
 *    same rule `app/api/maintenance/[id]/images/route.ts` applies to browser uploads.
 * 3. **Failure is per-attachment, never per-message.** A file that will not download, will not
 *    validate, or would breach quota is dropped and logged. The message still lands, because the
 *    text is what the landlord needs to read and a lost attachment is not worth losing it over.
 */

import { fileTypeFromBuffer } from "file-type";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import { getPrismaClient } from "@/lib/services/database/database";
import { logger } from "@/lib/utils/logger";

import type { NormalisedAttachment } from "./parse";

const log = logger.child({ component: "inbound-attachments" });

/** 10 MB, matching MAX_DOCUMENT_SIZE's default. A phone photo is 2-5 MB. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Total inbound-attachment bytes one account may hold. Separate from the document quota. */
export const INBOUND_QUOTA_BYTES = 250 * 1024 * 1024;

/**
 * What a stranger may put on our disk. Narrower than the document service's list — no
 * `application/json`, no Word — because this endpoint is reachable by anyone who learns the
 * address, whereas Documents requires a logged-in session.
 */
export const ALLOWED_INBOUND_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
]);

export interface StoredAttachment {
  filename: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
}

/** Injected so tests exercise the validation without a network or a Brevo account. */
export interface AttachmentDeps {
  fetchImpl?: typeof fetch;
  apiKey?: string;
}

function uploadBase(): string {
  return process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(process.cwd(), "uploads");
}

export function inboundDir(messageId: string): string {
  // messageId is a cuid we generated, never anything from the payload.
  return path.join(uploadBase(), "inbound", messageId);
}

/**
 * Bytes already held for this account, summed from the rows rather than by walking the
 * filesystem: it is exact, it is one query, and it cannot be skewed by a file left behind.
 */
export async function getInboundStorageBytes(userId: string): Promise<number> {
  const prisma = getPrismaClient();
  const result = await prisma.inboundAttachment.aggregate({
    _sum: { fileSize: true },
    where: { message: { userId } },
  });
  return result._sum.fileSize ?? 0;
}

async function download(token: string, deps: AttachmentDeps): Promise<Buffer | null> {
  const apiKey = deps.apiKey ?? process.env.BREVO_API_KEY;
  if (!apiKey) {
    log.warn("BREVO_API_KEY is unset; inbound attachments cannot be retrieved");
    return null;
  }

  const doFetch = deps.fetchImpl ?? fetch;
  const response = await doFetch(`https://api.brevo.com/v3/inbound/attachments/${token}`, {
    headers: { "api-key": apiKey, accept: "application/octet-stream" },
    // A webhook that hangs on a download makes Brevo retry the whole batch.
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    log.warn("Attachment download refused", { status: response.status });
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    // Checked after the read because Content-Length is another sender claim. The abort signal
    // above bounds how long an oversized body can take to arrive.
    log.warn("Attachment exceeds the size limit", { bytes: buffer.byteLength });
    return null;
  }
  return buffer;
}

/**
 * Download, validate and store one attachment. Returns null when it should not be kept — the
 * caller drops it and carries on with the message.
 */
export async function storeAttachment(
  messageId: string,
  userId: string,
  attachment: NormalisedAttachment,
  deps: AttachmentDeps = {},
): Promise<StoredAttachment | null> {
  let buffer: Buffer | null;
  try {
    buffer = await download(attachment.downloadToken, deps);
  } catch (error) {
    log.warn("Attachment download failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!buffer || buffer.byteLength === 0) return null;

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_INBOUND_MIME.has(detected.mime)) {
    log.warn("Attachment rejected: content does not match an allowed type", {
      claimed: attachment.declaredMimeType,
      detected: detected?.mime ?? "unrecognised",
    });
    return null;
  }

  const used = await getInboundStorageBytes(userId);
  if (used + buffer.byteLength > INBOUND_QUOTA_BYTES) {
    log.warn("Attachment rejected: inbound storage quota exceeded", { used });
    return null;
  }

  const dir = inboundDir(messageId);
  await fs.mkdir(dir, { recursive: true });
  // Random name plus the detected extension. The sender's filename is kept only as a label on
  // the row, so a name like `../../server.js` has nowhere to go.
  const storagePath = path.join(dir, `${randomUUID()}.${detected.ext}`);
  await fs.writeFile(storagePath, buffer);

  return {
    filename: attachment.filename,
    mimeType: detected.mime,
    fileSize: buffer.byteLength,
    storagePath,
  };
}
