-- Scope cutdown phase 7: remove correspondence and inbound mail.
--
-- Four tables go: the outbound side (correspondence_templates + the served-letter log) and the
-- inbound side (mail received via Brevo Inbound Parsing, plus its attachments). None of it is
-- on the core loop — bank movement → match → allocate → receipt → tax filing → audit trail —
-- and the receipt path never touched it: nothing under lib/services/receipts/,
-- lib/services/allocation/ or app/api/receipts/ ever called the email service. Automated rent
-- reminders survive; they run through lib/services/notifications/reminder-email.ts and write
-- email_logs, which the Brevo delivery-event webhook still updates.
--
-- Order matters here, unlike phases 5 and 6: inbound_attachments has a foreign key to
-- inbound_messages, so the child goes first. documents.id is referenced by
-- inbound_attachments.documentId, not the other way round, so documents is untouched.
--
-- NOT handled here, deliberately: the attachment FILES on disk. The rows that name them are
-- being deleted, so the reaper in lib/services/data-retention.ts can no longer find them. An
-- operator who has run Brevo Inbound Parsing should remove the inbound attachment directory by
-- hand; a migration that deletes files is a migration that cannot be rolled back.

DROP INDEX IF EXISTS "inbound_attachments_messageId_idx";
DROP TABLE IF EXISTS "inbound_attachments";

DROP INDEX IF EXISTS "inbound_messages_userId_receivedAt_idx";
DROP INDEX IF EXISTS "inbound_messages_userId_archived_idx";
DROP INDEX IF EXISTS "inbound_messages_tenantId_idx";
DROP INDEX IF EXISTS "inbound_messages_propertyId_idx";
DROP INDEX IF EXISTS "inbound_messages_messageId_key";
DROP TABLE IF EXISTS "inbound_messages";

DROP INDEX IF EXISTS "correspondence_userId_idx";
DROP INDEX IF EXISTS "correspondence_tenantId_idx";
DROP INDEX IF EXISTS "correspondence_propertyId_idx";
DROP INDEX IF EXISTS "correspondence_status_idx";
DROP TABLE IF EXISTS "correspondence";

DROP INDEX IF EXISTS "correspondence_templates_userId_idx";
DROP TABLE IF EXISTS "correspondence_templates";

-- NotificationType drops five values. Four (lease_expiring, payment_received,
-- document_uploaded, nrua_registration) had no producer anywhere in the codebase and never had;
-- inbound_message went with the inbox above. As in phase 5, the enum is client-side only under
-- SQLite — notifications.type is plain TEXT with no CHECK — so there is no type to alter, but a
-- row holding a dropped value would fail to deserialize on read.
DELETE FROM "notifications"
WHERE "type" IN (
  'inbound_message',
  'lease_expiring',
  'payment_received',
  'document_uploaded',
  'nrua_registration'
);
