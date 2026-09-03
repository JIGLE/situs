/**
 * Turning a parsed Brevo item into rows.
 *
 * The orchestration half of inbound mail: `parse.ts` and `matching.ts` are pure, this is where
 * Prisma and the filesystem come in.
 *
 * No audit-log entry is written on receipt, deliberately. `AuditLog` records decisions a person
 * made; the `InboundMessage` row already records that a message arrived, when, from whom, and
 * what the sender checks said — an audit row would be a second, less informative copy of it,
 * kept for seven years. The audit entry belongs on the *human* action that follows: confirming
 * which tenant a message belongs to. That lands with the Inbox UI.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { logger } from "@/lib/utils/logger";

import { storeAttachment, type AttachmentDeps } from "./attachments";
import { matchSender } from "./matching";
import type { NormalisedInboundMessage } from "./parse";

const log = logger.child({ component: "inbound-ingest" });

export interface IngestResult {
  /** Rows written. */
  stored: number;
  /** Items already present under the same Message-ID — a Brevo retry, not a new email. */
  duplicates: number;
  /** Items with nothing usable in them, or no account to file them against. */
  skipped: number;
  attachmentsStored: number;
}

/**
 * Which account inbound mail belongs to.
 *
 * Situs is single-tenant per deployment: the first account created owns the instance and is
 * provisioned ADMIN (`lib/services/auth/registration.ts`), so everything sent to the parse
 * address is theirs. The address itself is recorded on the row but not used for routing.
 *
 * The extension point, when there is a reason to build it, is a per-user parse address. That
 * needs an opaque per-user token rather than a user id in the local part — an address is
 * quoted in every reply and forwarded to strangers, so it must not carry an identifier that
 * means anything anywhere else.
 */
export async function resolveRecipientUserId(): Promise<string | null> {
  const prisma = getPrismaClient();
  const owner =
    (await prisma.user.findFirst({
      where: { role: "ADMIN" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })) ??
    (await prisma.user.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }));
  return owner?.id ?? null;
}

/**
 * Store one message. Returns "duplicate" when Brevo is retrying a batch it already delivered.
 *
 * Idempotency is on `rfcMessageId`, which is unique in the schema. A message with no Message-ID
 * header — rare, but legal — cannot be deduplicated and is stored unconditionally; the
 * alternative is dropping real mail to avoid a hypothetical double.
 */
async function storeMessage(
  userId: string,
  message: NormalisedInboundMessage,
  deps: AttachmentDeps,
): Promise<{ outcome: "stored" | "duplicate"; attachmentsStored: number }> {
  const prisma = getPrismaClient();

  if (message.rfcMessageId) {
    const existing = await prisma.inboundMessage.findUnique({
      where: { rfcMessageId: message.rfcMessageId },
      select: { id: true },
    });
    if (existing) return { outcome: "duplicate", attachmentsStored: 0 };
  }

  // Scoped to this account's tenants, so a match can only ever be against records the recipient
  // already holds.
  const tenants = await prisma.tenant.findMany({
    where: { userId },
    select: { id: true, email: true, propertyId: true },
  });
  const suggestion = matchSender(message.fromAddress, tenants);

  const created = await prisma.inboundMessage.create({
    data: {
      userId,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      toAddress: message.toAddress,
      subject: message.subject,
      textBody: message.textBody,
      rfcMessageId: message.rfcMessageId,
      inReplyTo: message.inReplyTo,
      spfResult: message.spfResult,
      dkimResult: message.dkimResult,
      // Suggestion only. `tenantId` and `propertyId` stay null until a person confirms it —
      // see the note on the model.
      suggestedTenantId: suggestion?.tenantId,
      receivedAt: message.receivedAt,
    },
    select: { id: true },
  });

  let attachmentsStored = 0;
  for (const attachment of message.attachments) {
    const stored = await storeAttachment(created.id, userId, attachment, deps);
    if (!stored) continue;
    await prisma.inboundAttachment.create({
      data: { messageId: created.id, ...stored },
    });
    attachmentsStored++;
  }

  await prisma.notification.create({
    data: {
      userId,
      type: "inbound_message",
      title: message.subject,
      message: `${message.fromName ?? message.fromAddress}: ${message.textBody.slice(0, 240)}`,
      entityType: "inboundMessage",
      entityId: created.id,
    },
  });

  return { outcome: "stored", attachmentsStored };
}

/**
 * Ingest a batch.
 *
 * One failing message never costs the rest of the batch: a non-2xx makes Brevo redeliver
 * everything, including the messages that did land, and the dedupe only covers items carrying a
 * Message-ID.
 */
export async function ingestMessages(
  messages: readonly NormalisedInboundMessage[],
  deps: AttachmentDeps = {},
): Promise<IngestResult> {
  const result: IngestResult = { stored: 0, duplicates: 0, skipped: 0, attachmentsStored: 0 };

  const userId = await resolveRecipientUserId();
  if (!userId) {
    // An instance with no accounts yet. Nothing to file mail against, and creating one here
    // would hand instance ownership to whoever sent the email.
    log.warn("Inbound mail arrived before any account exists; discarding", {
      count: messages.length,
    });
    result.skipped = messages.length;
    return result;
  }

  for (const message of messages) {
    try {
      const { outcome, attachmentsStored } = await storeMessage(userId, message, deps);
      if (outcome === "duplicate") result.duplicates++;
      else result.stored++;
      result.attachmentsStored += attachmentsStored;
    } catch (error) {
      result.skipped++;
      log.error("Failed to ingest a message", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
