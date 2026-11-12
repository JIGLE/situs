-- A rent increase is a row with the month it starts, not a new number typed over the old one.
--
-- The tenant has to be told in writing at least 30 days before an annual update takes effect
-- (Código Civil art. 1077), so the owner decides it a month or more ahead. `rent_increases` holds
-- that decision: the month the new rent starts, the old and new rent, the percentage and when the
-- notice went out. The rows that have taken effect stay as the lease's rent history.
--
-- Generated with `prisma migrate diff` from the previous schema to this one. As
-- docs/DATABASE_STRATEGY.md says, nothing applies migration files: the image's startup
-- `prisma db push` makes the same change.
-- CreateTable
CREATE TABLE "rent_increases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "previousRent" REAL NOT NULL,
    "newRent" REAL NOT NULL,
    "percent" REAL NOT NULL,
    "noticeDate" DATETIME,
    "appliedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rent_increases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "rent_increases_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- CreateIndex
CREATE INDEX "rent_increases_userId_idx" ON "rent_increases"("userId");
-- CreateIndex
CREATE INDEX "rent_increases_leaseId_idx" ON "rent_increases"("leaseId");
