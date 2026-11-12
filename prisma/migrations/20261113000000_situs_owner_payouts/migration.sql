-- A payout to a co-owner is a row: the amount handed over, the day, and the year whose net income
-- it settles. What a co-owner is owed is worked out from the ledger and the dated shares; only the
-- money paid out is stored (lib/services/owner-payouts/).
--
-- Generated with `prisma migrate diff` from the previous schema to this one. As
-- docs/DATABASE_STRATEGY.md says, nothing applies migration files: the image's startup
-- `prisma db push` makes the same change.
-- CreateTable
CREATE TABLE "owner_payouts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "paidAt" DATETIME NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "owner_payouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "owner_payouts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "owner_payouts_userId_year_idx" ON "owner_payouts"("userId", "year");

-- CreateIndex
CREATE INDEX "owner_payouts_ownerId_idx" ON "owner_payouts"("ownerId");

