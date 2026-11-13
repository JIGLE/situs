-- Building expenses split across the building's units, each unit's permilagem, and how exactly a
-- property's coordinates place it (lib/services/buildings/, lib/services/geocoding/).
--
-- As docs/DATABASE_STRATEGY.md says, nothing applies migration files: the image's startup
-- `prisma db push` makes the same change.
ALTER TABLE "properties" ADD COLUMN "locationPrecision" TEXT;
ALTER TABLE "properties" ADD COLUMN "permilage" REAL;

CREATE TABLE "building_expenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "isDeductible" BOOLEAN NOT NULL DEFAULT true,
    "vendorName" TEXT,
    "vendorVat" TEXT,
    "documentId" TEXT,
    "splitBasis" TEXT NOT NULL DEFAULT 'equal',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "building_expenses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "building_expenses_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "building_expenses_userId_idx" ON "building_expenses"("userId");
CREATE INDEX "building_expenses_buildingId_idx" ON "building_expenses"("buildingId");

ALTER TABLE "expenses" ADD COLUMN "buildingExpenseId" TEXT REFERENCES "building_expenses" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
