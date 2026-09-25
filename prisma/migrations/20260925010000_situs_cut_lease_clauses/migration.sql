-- What only the AI contract reader wrote: lease clauses.
--
-- The owner wants no AI API in Situs. A free-form signed contract, often a scan, cannot be read
-- reliably without one, so the contract import that read it with Claude is removed, and with it
-- the only writer of this table. A lease is entered through its form, which keeps every field
-- #410 added: NIFs, co-tenants and guarantors, the AT contract number, the stored contract.
--
-- The statements below are `prisma migrate diff --from-schema <before> --to-schema <after>
-- --script`, unedited: a comparison of two schema files that touches no database.
--
-- Nothing applies this file ("How the schema reaches a database", docs/DATABASE_STRATEGY.md).
-- The image pushes prisma/schema.prisma at start (scripts/ensure-sqlite.js), copies the database
-- to <file>.bak-<timestamp> when the push would drop data, and then drops the table itself.

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "lease_clauses";
PRAGMA foreign_keys=on;
