-- A tenant, an owner and a property no longer need an email, a phone or rooms.
--
-- Finanças names a landlord and a tenant by NIF and name, and says nothing of an email, a phone
-- number or how many rooms a property has, so the import that reads it has nothing to put there.
-- `tenants.email`, `tenants.phone`, `owners.email`, `properties.bedrooms` and `properties.bathrooms`
-- are nullable now. A blank is stored as NULL, and unknown rooms as NULL, not 0, which reads as a
-- studio. Existing rows keep what they have.
--
-- An email was unique across every account: a second tenant with an address already on file got a
-- 500, and the refusal told a landlord that someone else's tenant had it. It is unique per account
-- now, `(userId, email)`, where any number of NULLs are allowed. The two old indexes,
-- `tenants_email_key` and `owners_email_key`, go with the old tables; every row that satisfied them
-- satisfies the new ones.
--
-- SQLite cannot relax a NOT NULL or replace a unique index in place, so `owners`, `properties` and
-- `tenants` are rebuilt: every row is copied across unchanged, with foreign keys off while it is,
-- so nothing cascades. Nothing is lost.
--
-- Generated with `prisma migrate diff` from the previous schema to this one, which touches no
-- database. As docs/DATABASE_STRATEGY.md says, nothing applies migration files: the image's
-- startup `prisma db push` makes the same change.
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "owners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_owners" ("address", "createdAt", "email", "emailNotifications", "id", "name", "notes", "phone", "portalAccess", "role", "taxIdentificationNumber", "taxRate", "taxResidenceCountry", "updatedAt", "userId") SELECT "address", "createdAt", "email", "emailNotifications", "id", "name", "notes", "phone", "portalAccess", "role", "taxIdentificationNumber", "taxRate", "taxResidenceCountry", "updatedAt", "userId" FROM "owners";
DROP TABLE "owners";
ALTER TABLE "new_owners" RENAME TO "owners";
CREATE UNIQUE INDEX "owners_userId_email_key" ON "owners"("userId", "email");
CREATE TABLE "new_properties" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "streetAddress" TEXT,
    "city" TEXT,
    "zipCode" TEXT,
    "country" TEXT DEFAULT 'PT',
    "latitude" REAL,
    "longitude" REAL,
    "addressVerified" BOOLEAN NOT NULL DEFAULT false,
    "buildingId" TEXT,
    "buildingName" TEXT,
    "type" TEXT NOT NULL,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "rent" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "distributionFrequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "createdByOwnerId" TEXT,
    "cadasterReference" TEXT,
    "fraction" TEXT,
    "rentalRegime" TEXT NOT NULL DEFAULT 'standard',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "properties_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "properties_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_properties" ("address", "addressVerified", "bathrooms", "bedrooms", "buildingId", "buildingName", "cadasterReference", "city", "country", "createdAt", "createdByOwnerId", "description", "distributionFrequency", "fraction", "id", "image", "latitude", "longitude", "name", "rent", "rentalRegime", "status", "streetAddress", "type", "updatedAt", "userId", "zipCode") SELECT "address", "addressVerified", "bathrooms", "bedrooms", "buildingId", "buildingName", "cadasterReference", "city", "country", "createdAt", "createdByOwnerId", "description", "distributionFrequency", "fraction", "id", "image", "latitude", "longitude", "name", "rent", "rentalRegime", "status", "streetAddress", "type", "updatedAt", "userId", "zipCode" FROM "properties";
DROP TABLE "properties";
ALTER TABLE "new_properties" RENAME TO "properties";
CREATE INDEX "properties_userId_idx" ON "properties"("userId");
CREATE INDEX "properties_status_idx" ON "properties"("status");
CREATE INDEX "properties_userId_status_idx" ON "properties"("userId", "status");
CREATE TABLE "new_tenants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "propertyId" TEXT,
    "rent" REAL NOT NULL,
    "leaseStart" DATETIME NOT NULL,
    "leaseEnd" DATETIME NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastPayment" DATETIME,
    "notes" TEXT,
    "taxId" TEXT,
    "taxCountry" TEXT DEFAULT 'PT',
    "idDocument" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tenants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tenants_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_tenants" ("createdAt", "email", "id", "idDocument", "lastPayment", "leaseEnd", "leaseStart", "name", "notes", "paymentStatus", "phone", "propertyId", "rent", "taxCountry", "taxId", "updatedAt", "userId") SELECT "createdAt", "email", "id", "idDocument", "lastPayment", "leaseEnd", "leaseStart", "name", "notes", "paymentStatus", "phone", "propertyId", "rent", "taxCountry", "taxId", "updatedAt", "userId" FROM "tenants";
DROP TABLE "tenants";
ALTER TABLE "new_tenants" RENAME TO "tenants";
CREATE INDEX "tenants_userId_idx" ON "tenants"("userId");
CREATE INDEX "tenants_propertyId_idx" ON "tenants"("propertyId");
CREATE INDEX "tenants_paymentStatus_idx" ON "tenants"("paymentStatus");
CREATE INDEX "tenants_userId_paymentStatus_idx" ON "tenants"("userId", "paymentStatus");
CREATE UNIQUE INDEX "tenants_userId_email_key" ON "tenants"("userId", "email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
