-- What nothing needed: the Unit model.
--
-- A unit duplicated what a property and a building already model — a fração is a property — and
-- no screen could create one after the units view was deleted. The demo seed made six that
-- nothing read. The units table goes, and so does the optional `unitId` on leases, expenses and
-- documents, with its foreign key (and, on expenses, its index). A lease, expense or document that
-- named a unit keeps its property.
--
-- The property map and the receipt-based payment matrix, removed in the same step, stored
-- nothing.
--
-- SQLite cannot drop a column that carries a foreign key, so the three tables are rebuilt without
-- it. The statements below are `prisma migrate diff --from-schema <before> --to-schema <after>
-- --script`, unedited: a comparison of two schema files that touches no database.
--
-- Nothing applies this file ("How the schema reaches a database", docs/DATABASE_STRATEGY.md).
-- The image pushes prisma/schema.prisma at start (scripts/ensure-sqlite.js), copies the database
-- to <file>.bak-<timestamp> when the push would drop data, and then drops all of this itself.

-- DropIndex
DROP INDEX "units_propertyId_number_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "units";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_expenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "leaseId" TEXT,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "isDeductible" BOOLEAN NOT NULL DEFAULT true,
    "vendorName" TEXT,
    "vendorVat" TEXT,
    "documentId" TEXT,
    "taxReviewStatus" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceRule" TEXT,
    "recurrenceDay" INTEGER,
    "recurrenceEnd" DATETIME,
    "parentExpenseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "expenses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "expenses_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "expenses_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "expenses_parentExpenseId_fkey" FOREIGN KEY ("parentExpenseId") REFERENCES "expenses" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "expenses_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_expenses" ("amount", "category", "createdAt", "date", "description", "documentId", "id", "isDeductible", "isRecurring", "leaseId", "parentExpenseId", "propertyId", "recurrenceDay", "recurrenceEnd", "recurrenceRule", "taxReviewStatus", "updatedAt", "userId", "vendorName", "vendorVat") SELECT "amount", "category", "createdAt", "date", "description", "documentId", "id", "isDeductible", "isRecurring", "leaseId", "parentExpenseId", "propertyId", "recurrenceDay", "recurrenceEnd", "recurrenceRule", "taxReviewStatus", "updatedAt", "userId", "vendorName", "vendorVat" FROM "expenses";
DROP TABLE "expenses";
ALTER TABLE "new_expenses" RENAME TO "expenses";
CREATE INDEX "expenses_userId_idx" ON "expenses"("userId");
CREATE INDEX "expenses_propertyId_idx" ON "expenses"("propertyId");
CREATE INDEX "expenses_leaseId_idx" ON "expenses"("leaseId");
CREATE INDEX "expenses_date_idx" ON "expenses"("date");
CREATE INDEX "expenses_category_idx" ON "expenses"("category");
CREATE INDEX "expenses_isDeductible_idx" ON "expenses"("isDeductible");
CREATE INDEX "expenses_isRecurring_idx" ON "expenses"("isRecurring");
CREATE INDEX "expenses_parentExpenseId_idx" ON "expenses"("parentExpenseId");
CREATE TABLE "new_leases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "monthlyRent" REAL NOT NULL,
    "deposit" REAL NOT NULL DEFAULT 0,
    "contractFile" BLOB,
    "contractFileName" TEXT,
    "contractFileSize" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "renewalNoticeDays" INTEGER NOT NULL DEFAULT 60,
    "isRendaAcessivel" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "renewalStatus" TEXT,
    "renewalOfferedAt" DATETIME,
    "renewalRespondedAt" DATETIME,
    "renewalNotes" TEXT,
    "renewalProposedRent" REAL,
    "renewalStartDate" DATETIME,
    "renewalEndDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "leases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "leases_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "leases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_leases" ("autoRenew", "contractFile", "contractFileName", "contractFileSize", "createdAt", "deposit", "endDate", "id", "isRendaAcessivel", "monthlyRent", "notes", "propertyId", "renewalEndDate", "renewalNotes", "renewalNoticeDays", "renewalOfferedAt", "renewalProposedRent", "renewalRespondedAt", "renewalStartDate", "renewalStatus", "startDate", "status", "tenantId", "updatedAt", "userId") SELECT "autoRenew", "contractFile", "contractFileName", "contractFileSize", "createdAt", "deposit", "endDate", "id", "isRendaAcessivel", "monthlyRent", "notes", "propertyId", "renewalEndDate", "renewalNotes", "renewalNoticeDays", "renewalOfferedAt", "renewalProposedRent", "renewalRespondedAt", "renewalStartDate", "renewalStatus", "startDate", "status", "tenantId", "updatedAt", "userId" FROM "leases";
DROP TABLE "leases";
ALTER TABLE "new_leases" RENAME TO "leases";
CREATE INDEX "leases_userId_idx" ON "leases"("userId");
CREATE INDEX "leases_propertyId_idx" ON "leases"("propertyId");
CREATE INDEX "leases_tenantId_idx" ON "leases"("tenantId");
CREATE INDEX "leases_status_idx" ON "leases"("status");
CREATE INDEX "leases_userId_status_idx" ON "leases"("userId", "status");
CREATE TABLE "new_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "propertyId" TEXT,
    "ownerId" TEXT,
    "tenantId" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "documents_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_documents" ("createdAt", "description", "expiresAt", "fileSize", "id", "mimeType", "name", "ownerId", "propertyId", "storagePath", "tenantId", "type", "updatedAt", "userId") SELECT "createdAt", "description", "expiresAt", "fileSize", "id", "mimeType", "name", "ownerId", "propertyId", "storagePath", "tenantId", "type", "updatedAt", "userId" FROM "documents";
DROP TABLE "documents";
ALTER TABLE "new_documents" RENAME TO "documents";
CREATE INDEX "documents_userId_idx" ON "documents"("userId");
CREATE INDEX "documents_propertyId_idx" ON "documents"("propertyId");
CREATE INDEX "documents_type_idx" ON "documents"("type");
CREATE INDEX "documents_expiresAt_idx" ON "documents"("expiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

