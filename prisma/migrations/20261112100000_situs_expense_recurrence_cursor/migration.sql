-- A recurring expense makes its copies as they fall due (lib/services/expenses/recurring.ts).
-- `recurrenceGeneratedThrough` is the last date a copy was made for, so a copy the owner deleted
-- (a month the fee was not charged) is not made again. NULL: no copy yet; copies start after the
-- expense's own date.
--
-- As docs/DATABASE_STRATEGY.md says, nothing applies migration files: the image's startup
-- `prisma db push` makes the same change.
ALTER TABLE "expenses" ADD COLUMN "recurrenceGeneratedThrough" DATETIME;
