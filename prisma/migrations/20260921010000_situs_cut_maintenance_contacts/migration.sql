-- Scope cutdown phase 6: remove the vendor registry (MaintenanceContact, "Contacts" in the UI).
--
-- It was a standalone address book of contractors, vendors and staff, reachable from the
-- Contacts tab on /people and from /contacts. Nothing else read it: no property, lease,
-- receipt, expense or bank row ever pointed at a contact. With ticketing gone in phase 5 there
-- is nothing left to dispatch a contractor to, so the registry is an address book the app keeps
-- for its own sake.
--
-- A leaf drop again — no table references maintenance_contacts, and the model declared no
-- @@index, so there is nothing to drop but the table. The rows go with it; git history is the
-- archive.

DROP TABLE IF EXISTS "maintenance_contacts";
