-- What a lease needs to be filed in Finanças: the tenant's NIF, the lease's other parties, and
-- AT's number for the contract.
--
-- AT's webservice registers contracts and issues receipts against them, but cannot list the
-- contracts a landlord already has. So everything a receipt names has to be recorded here:
--   - the tenant's NIF, or, for a tenant with no Portuguese NIF, an identity document and the
--     country that issued it (`tenants`);
--   - co-tenants and guarantors (`lease_parties`, new): AT lists every tenant of the contract,
--     while the ledger, bank matching and receipts keep keying on the lease's main tenant;
--   - AT's contract number and version (`leases`);
--   - the property's fração (`properties`), beside the matriz article it already had.
--
-- Additions only: five nullable columns, one with a default, and a new table. Nothing existing
-- is rebuilt or rewritten. The NIF and document columns are encrypted by the PII extension
-- (PII_FIELDS in lib/utils/pii-encryption.ts), so what this file creates holds ciphertext.
--
-- Generated with `prisma migrate diff` from the previous schema to this one, which touches no
-- database. As docs/DATABASE_STRATEGY.md says, nothing applies migration files: the image's
-- startup `prisma db push` makes the same change.

-- AlterTable
ALTER TABLE "properties" ADD COLUMN "fraction" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "idDocument" TEXT;
ALTER TABLE "tenants" ADD COLUMN "taxCountry" TEXT DEFAULT 'PT';
ALTER TABLE "tenants" ADD COLUMN "taxId" TEXT;

-- AlterTable
ALTER TABLE "leases" ADD COLUMN "atContractNumber" TEXT;
ALTER TABLE "leases" ADD COLUMN "atContractVersion" INTEGER;

-- CreateTable
CREATE TABLE "lease_parties" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "taxCountry" TEXT NOT NULL DEFAULT 'PT',
    "idDocument" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "lease_parties_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lease_parties_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "lease_parties_userId_idx" ON "lease_parties"("userId");

-- CreateIndex
CREATE INDEX "lease_parties_leaseId_idx" ON "lease_parties"("leaseId");

