-- Portugal only, in euros.
--
-- Spain goes: the NRUA registration and Modelo 179 records with their routes, the Spanish
-- connector, the Ley de Vivienda fields (zona tensionada, the prior contract rent the rent cap
-- read) and the stressed-zone table that nothing read. So does the lease tax regime, which only
-- ever said "Portugal" or "Spain", and the fiscal country beside a property's address country.
--
-- Every amount is shown in euros, so the stored currency on a property, an income distribution
-- and the user settings goes with the Currency enum, and the settings lose the default tax
-- country. Bank accounts and movements keep the currency their bank reports.
--
-- `properties.country` and `buildings.country` stay: they are address data, default "PT", and
-- no form can set anything else now.
--
-- Nothing applies this file ("How the schema reaches a database", docs/DATABASE_STRATEGY.md).
-- The image pushes prisma/schema.prisma at start (scripts/ensure-sqlite.js), copies the database
-- to <file>.bak-<timestamp> when the push would drop data, and then drops all of this itself.

DROP INDEX IF EXISTS "nrua_registrations_landlordNif_idx";
DROP INDEX IF EXISTS "nrua_registrations_status_idx";
DROP INDEX IF EXISTS "nrua_registrations_leaseId_idx";
DROP TABLE IF EXISTS "nrua_registrations";

DROP INDEX IF EXISTS "modelo179_submissions_userId_periodYear_idx";
DROP INDEX IF EXISTS "modelo179_submissions_leaseId_periodYear_key";
DROP TABLE IF EXISTS "modelo179_submissions";

DROP INDEX IF EXISTS "stressed_zones_municipalityCode_idx";
DROP INDEX IF EXISTS "stressed_zones_country_isActive_idx";
DROP INDEX IF EXISTS "stressed_zones_municipalityCode_communityCode_key";
DROP TABLE IF EXISTS "stressed_zones";

ALTER TABLE "properties" DROP COLUMN "isZonaTensionada";
ALTER TABLE "properties" DROP COLUMN "propertyCountry";
ALTER TABLE "properties" DROP COLUMN "currency";

ALTER TABLE "leases" DROP COLUMN "taxRegime";
ALTER TABLE "leases" DROP COLUMN "isZonaTensionada";
ALTER TABLE "leases" DROP COLUMN "priorContractRent";

ALTER TABLE "income_distributions" DROP COLUMN "currency";

ALTER TABLE "user_settings" DROP COLUMN "defaultCurrency";
ALTER TABLE "user_settings" DROP COLUMN "defaultTaxCountry";
