#!/usr/bin/env node
/*
 * Strip `counterpartyIban` from BankTransaction.rawData on rows written before
 * lib/services/bank/csv.ts gained redactRowForStorage().
 *
 * The import wrote the IBAN twice: AES-256-GCM encrypted into `counterpartyIban`, and again
 * in clear inside `rawData`, an ordinary unencrypted column. Fixing the write site stops new
 * rows carrying it; it does nothing for rows already stored. This does those.
 *
 * Idempotent by construction: a row whose rawData has no `counterpartyIban` key is left
 * untouched, so re-running is free and a partial run can simply be re-run.
 *
 * Deliberately standalone, mirroring scripts/backfill-pii-encryption.js: it talks to Prisma
 * directly and rewrites one column, rather than reading rows through the app's services.
 *
 * Note this needs NO encryption key. It only removes a field from a JSON string; the encrypted
 * `counterpartyIban` column and `counterpartyIbanHash` already hold everything the matching
 * pipeline reads, so nothing is lost and nothing needs decrypting.
 *
 * Usage:
 *   node scripts/backfill-rawdata-redaction.js           # apply
 *   node scripts/backfill-rawdata-redaction.js --dry-run # report only, no writes
 */

"use strict";

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const dryRun = process.argv.includes("--dry-run");
const BATCH = 500;

async function main() {
  const prisma = new PrismaClient();
  let scanned = 0;
  let rewritten = 0;
  let unparseable = 0;
  let cursor;

  console.info(
    dryRun
      ? "[rawdata-redaction] DRY RUN — reporting only, no writes"
      : "[rawdata-redaction] applying",
  );

  try {
    // Cursor-paginated rather than a single findMany: a long-lived instance can hold a lot of
    // transactions, and loading them all to rewrite one column each is avoidable.
    for (;;) {
      const rows = await prisma.bankTransaction.findMany({
        where: { rawData: { not: null } },
        select: { id: true, rawData: true },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;

      for (const row of rows) {
        scanned += 1;

        let parsed;
        try {
          parsed = JSON.parse(row.rawData);
        } catch {
          // Not JSON — leave it alone and say so. Silently skipping would make the summary
          // claim a completeness this run did not achieve.
          unparseable += 1;
          console.warn(`[rawdata-redaction] ${row.id}: rawData is not valid JSON, skipped`);
          continue;
        }

        if (parsed === null || typeof parsed !== "object") continue;
        if (!Object.prototype.hasOwnProperty.call(parsed, "counterpartyIban")) continue;

        delete parsed.counterpartyIban;
        rewritten += 1;

        if (!dryRun) {
          await prisma.bankTransaction.update({
            where: { id: row.id },
            data: { rawData: JSON.stringify(parsed) },
          });
        }
      }
    }

    console.info(
      `[rawdata-redaction] scanned ${scanned}, ` +
        `${dryRun ? "would rewrite" : "rewrote"} ${rewritten}` +
        (unparseable ? `, skipped ${unparseable} unparseable` : ""),
    );

    // A non-zero skip count means rows still hold whatever they held. Exit non-zero so a
    // scripted run does not record this as a clean completion.
    if (unparseable > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[rawdata-redaction] failed:", err);
  process.exit(1);
});
