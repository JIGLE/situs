-- The co-owner who paid an expense from their own pocket (Pago por). The year's shares give it
-- back to them (lib/services/owner-payouts/split.ts). NULL: paid from the account that collects
-- the rent.
--
-- As docs/DATABASE_STRATEGY.md says, nothing applies migration files: the image's startup
-- `prisma db push` makes the same change.
ALTER TABLE "expenses" ADD COLUMN "paidByOwnerId" TEXT REFERENCES "owners" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
