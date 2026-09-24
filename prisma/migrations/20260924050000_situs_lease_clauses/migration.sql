-- What a lease's contract says about renewal, rent updates, termination and the deposit.
--
-- A lease imported from its signed contract keeps these clauses as the contract words them: a
-- summary for the reader, and the quoted text with its page. They are what renewal and
-- rent-update notices have to follow. One new table; nothing existing changes.
--
-- CreateTable
CREATE TABLE "lease_clauses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "page" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lease_clauses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lease_clauses_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "lease_clauses_userId_idx" ON "lease_clauses"("userId");

-- CreateIndex
CREATE INDEX "lease_clauses_leaseId_idx" ON "lease_clauses"("leaseId");

