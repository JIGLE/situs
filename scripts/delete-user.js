#!/usr/bin/env node
/*
 * Utility script to remove a user (and related auth data) by email.
 *
 * Usage:
 *   node scripts/delete-user.js user@example.com
 *   USER_EMAIL=user@example.com node scripts/delete-user.js
 *
 * The script deletes:
 *   - sessions linked to the user
 *   - OAuth accounts linked to the user
 *   - verification tokens for the user's email
 *   - the user record itself
 *
 * It also removes any orphaned OAuth accounts whose user record no longer exists.
 */

"use strict";

require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

// Prisma 7 connects only through a driver adapter — a bare `new PrismaClient()` throws before doing
// anything. This is the adapter lib/services/database/database.ts uses, without its PII extension.
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.NODE_ENV === "production") {
    // Guessing a path here would open (and create) an empty file and report nothing to do.
    console.error("DATABASE_URL is not set. In the container it is file:/app/data/situs.sqlite.");
    process.exit(1);
  }
  return "file:./dev.db";
}

const emailArg = process.argv[2] || process.env.USER_EMAIL;

if (!emailArg) {
  console.error("Error: missing email. Pass it as an argument or set USER_EMAIL.");
  console.error("Example: node scripts/delete-user.js user@example.com");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl() }) });

async function deleteUserByEmail(email) {
  console.log(`Deleting user data for ${email}...`);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!user) {
    console.log(`No user found for ${email}. Nothing to delete.`);
    return;
  }

  const [sessionResult, accountResult, tokenResult] = await Promise.all([
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.account.deleteMany({ where: { userId: user.id } }),
    prisma.verificationToken.deleteMany({ where: { identifier: email } }),
  ]);

  await prisma.user.delete({ where: { id: user.id } });

  console.log("Removed user and related records:", {
    email,
    sessions: sessionResult.count,
    accounts: accountResult.count,
    verificationTokens: tokenResult.count,
  });
}

async function deleteOrphanedAccounts() {
  const [accounts, users] = await Promise.all([
    prisma.account.findMany({
      select: { id: true, userId: true, provider: true, providerAccountId: true },
    }),
    prisma.user.findMany({
      select: { id: true },
    }),
  ]);

  const validUserIds = new Set(users.map((user) => user.id));
  const orphaned = accounts.filter((account) => !validUserIds.has(account.userId));

  if (!orphaned.length) {
    console.log("No orphaned OAuth accounts detected.");
    return;
  }

  const deleteResult = await prisma.account.deleteMany({
    where: { id: { in: orphaned.map((account) => account.id) } },
  });

  console.log("Removed orphaned OAuth accounts:", {
    count: deleteResult.count,
    providerAccountIds: orphaned.map((account) => account.providerAccountId),
  });
}

async function main() {
  try {
    await deleteUserByEmail(emailArg);
    await deleteOrphanedAccounts();
  } catch (error) {
    console.error("Failed to delete user data:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
