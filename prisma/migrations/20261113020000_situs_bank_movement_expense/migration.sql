-- Money going out can be recorded as the expense it paid (lib/services/expenses/bank-expenses.ts).
-- One movement pays one expense, so the link is unique; deleting the expense clears it.
--
-- As docs/DATABASE_STRATEGY.md says, nothing applies migration files: the image's startup
-- `prisma db push` makes the same change.
ALTER TABLE "bank_transactions" ADD COLUMN "expenseId" TEXT REFERENCES "expenses" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "bank_transactions_expenseId_key" ON "bank_transactions"("expenseId");
