-- Own use: Situs is one owner's instance, shared with co-owners, not a product to sell.
--
-- Stripe billing goes with its plans and limits, so the subscription rows go too; an instance
-- without a Stripe key never wrote one. The product-event sink goes as well: no client ever
-- posted to it. The landing page's counters lived in process memory and leave nothing here.
--
-- `user_settings.onboardingDismissedAt` stays. The onboarding checklist still reads it; it was
-- only ever counted alongside the events, never part of them.
--
-- Nothing applies this file ("How the schema reaches a database", docs/DATABASE_STRATEGY.md).
-- The image pushes prisma/schema.prisma at start (scripts/ensure-sqlite.js), copies the database
-- to <file>.bak-<timestamp> when the push would drop data, and then drops all of this itself.

DROP INDEX IF EXISTS "subscriptions_stripeSubscriptionId_idx";
DROP INDEX IF EXISTS "subscriptions_stripeCustomerId_idx";
DROP INDEX IF EXISTS "subscriptions_userId_key";
DROP TABLE IF EXISTS "subscriptions";

DROP INDEX IF EXISTS "product_events_createdAt_idx";
DROP INDEX IF EXISTS "product_events_userId_name_idx";
DROP TABLE IF EXISTS "product_events";
