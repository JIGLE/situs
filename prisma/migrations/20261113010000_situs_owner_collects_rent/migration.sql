-- The owner who collects a shared property's rent: Finance › Owners' shares shows what they keep
-- rather than what is still to pay them (lib/services/owner-payouts/).
--
-- Generated with `prisma migrate diff` from the previous schema to this one. As
-- docs/DATABASE_STRATEGY.md says, nothing applies migration files: the image's startup
-- `prisma db push` makes the same change.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_owners" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "role" TEXT NOT NULL DEFAULT 'REGULAR',
    "taxResidenceCountry" TEXT,
    "taxIdentificationNumber" TEXT,
    "taxRate" REAL,
    "portalAccess" BOOLEAN NOT NULL DEFAULT true,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "collectsRent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "owners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_owners" ("address", "createdAt", "email", "emailNotifications", "id", "name", "notes", "phone", "portalAccess", "role", "taxIdentificationNumber", "taxRate", "taxResidenceCountry", "updatedAt", "userId") SELECT "address", "createdAt", "email", "emailNotifications", "id", "name", "notes", "phone", "portalAccess", "role", "taxIdentificationNumber", "taxRate", "taxResidenceCountry", "updatedAt", "userId" FROM "owners";
DROP TABLE "owners";
ALTER TABLE "new_owners" RENAME TO "owners";
CREATE UNIQUE INDEX "owners_userId_email_key" ON "owners"("userId", "email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

