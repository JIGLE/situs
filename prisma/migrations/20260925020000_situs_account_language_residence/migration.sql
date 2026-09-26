-- The owner's language, and their country of tax residence, on the account.
--
-- Language: the interface always read the `situs-locale` cookie, and the language saved on the
-- account was read only by reminder emails, which defaulted to English while the app defaults to
-- Portuguese. Choosing a language now writes both, so the default becomes Portuguese, and
-- `languageChosenAt` records that the owner chose it. A device with no language of its own adopts
-- the account's at sign-in only when that date is set: rows from before it hold the old default,
-- "en", with no date, and a default is not a choice.
--
-- Residence: an ISO 3166-1 alpha-2 code, default PT, shown under the owner's name. IRS and AT
-- features read it later, since a non-resident landlord is taxed differently.
--
-- SQLite cannot change a column's default in place, so `user_settings` is rebuilt: every existing
-- row is copied across unchanged, and the two new columns take their defaults. Nothing is lost.
--
-- Generated with `prisma migrate diff` from the previous schema to this one, which touches no
-- database. As docs/DATABASE_STRATEGY.md says, nothing applies migration files: the image's
-- startup `prisma db push` makes the same change.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_user_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "language" TEXT NOT NULL DEFAULT 'pt',
    "languageChosenAt" DATETIME,
    "residenceCountry" TEXT NOT NULL DEFAULT 'PT',
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "taxReminderNotifications" BOOLEAN NOT NULL DEFAULT true,
    "distributionNotifications" BOOLEAN NOT NULL DEFAULT true,
    "onboardingDismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_user_settings" ("createdAt", "distributionNotifications", "emailNotifications", "id", "language", "onboardingDismissedAt", "taxReminderNotifications", "theme", "updatedAt", "userId") SELECT "createdAt", "distributionNotifications", "emailNotifications", "id", "language", "onboardingDismissedAt", "taxReminderNotifications", "theme", "updatedAt", "userId" FROM "user_settings";
DROP TABLE "user_settings";
ALTER TABLE "new_user_settings" RENAME TO "user_settings";
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

