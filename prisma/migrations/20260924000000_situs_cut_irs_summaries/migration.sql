-- Remove the IRS summaries: the annual tax-filing wizard with the per-country fiscal plugins it ran
-- on, the tax rules store those plugins read their rates from, the fiscal profile (residency, NHR,
-- IFICI), and the tax calculator behind Finance's yearly estimate and the income split's per-owner
-- tax. The owner files their own IRS return. The split stays: it still calculates and stores each
-- owner's share, and only the tax estimate on it goes.
--
-- Nothing applies this file ("How the schema reaches a database", docs/DATABASE_STRATEGY.md). The
-- image pushes prisma/schema.prisma at start (scripts/ensure-sqlite.js), copies the database to
-- <file>.bak-<timestamp> when the push would drop data, and then drops all of this itself. The
-- users columns were added by a push, never by a migration: a history replayed from empty would
-- not have them.

DROP INDEX IF EXISTS "tax_filings_userId_year_idx";
DROP INDEX IF EXISTS "tax_filings_userId_year_country_regime_key";
DROP TABLE IF EXISTS "tax_filings";

DROP INDEX IF EXISTS "tax_rules_country_year_idx";
DROP INDEX IF EXISTS "tax_rules_country_regime_ruleType_year_key";
DROP TABLE IF EXISTS "tax_rules";

-- The fiscal profile: residency, and the NHR and IFICI regimes, which only chose a tax bracket.
ALTER TABLE "users" DROP COLUMN "fiscalResidency";
ALTER TABLE "users" DROP COLUMN "nhrStatus";
ALTER TABLE "users" DROP COLUMN "nhrYear";
ALTER TABLE "users" DROP COLUMN "ificiStatus";
ALTER TABLE "users" DROP COLUMN "ificiYear";

-- The split's tax estimate, and the "split before or after tax" mode it needed.
ALTER TABLE "income_distribution_shares" DROP COLUMN "taxAmount";
ALTER TABLE "income_distribution_shares" DROP COLUMN "netShare";
ALTER TABLE "income_distribution_shares" DROP COLUMN "taxCountry";
ALTER TABLE "income_distribution_shares" DROP COLUMN "taxRate";
ALTER TABLE "income_distributions" DROP COLUMN "taxMode";
ALTER TABLE "properties" DROP COLUMN "incomeSplitMode";
