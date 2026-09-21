-- Scope cutdown phase 5: remove the maintenance/operations ticketing system.
--
-- Situs is being narrowed to its core loop — bank movement → match → allocate →
-- receipt → tax filing → audit trail. Ticketing is a work-order tracker that sits
-- entirely outside that chain: nothing in the rent ledger, the matching engine, the
-- receipt lifecycle or either tax connector reads a ticket.
--
-- No other table references maintenance_tickets, so this is a leaf drop. The rows
-- go with it; git history is the archive, per the repo's own rule.
--
-- MaintenanceContact (the vendor registry, "contacts" in the UI) is a separate
-- model and is NOT touched here — it is cut in its own phase.

DROP INDEX IF EXISTS "maintenance_tickets_userId_status_idx";
DROP INDEX IF EXISTS "maintenance_tickets_priority_idx";
DROP INDEX IF EXISTS "maintenance_tickets_status_idx";
DROP INDEX IF EXISTS "maintenance_tickets_propertyId_idx";
DROP INDEX IF EXISTS "maintenance_tickets_userId_idx";

DROP TABLE IF EXISTS "maintenance_tickets";

-- NotificationType drops `maintenance_created` and `maintenance_completed` with the feature.
-- Under SQLite a Prisma enum is client-side only — `notifications.type` is plain TEXT with no
-- CHECK constraint — so there is no type to alter, but a row carrying a dropped value would
-- fail to deserialize on read. Nothing ever wrote these two (the ticket routes emitted no
-- notification), so this clears nothing in practice and costs nothing if that is wrong.
DELETE FROM "notifications" WHERE "type" IN ('maintenance_created', 'maintenance_completed');
