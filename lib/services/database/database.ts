import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { logger } from "@/lib/utils/logger";
import { piiEncryptionExtension } from "./pii-extension";

declare global {
  var prisma: PrismaClient | undefined;
}

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    if (process.env.DATABASE_URL) {
      const dbUrl = process.env.DATABASE_URL;

      // For SQLite, verify the file exists and is writable before constructing
      if (dbUrl.startsWith("file:")) {
        const sqlitePath = dbUrl.replace(/^file:\/\//, "").replace(/^file:/, "");
        const resolvedPath = require("path").resolve(process.cwd(), sqlitePath);
        const fs = require("fs");
        const exists = fs.existsSync(resolvedPath);
        logger.debug("Using SQLite database", { path: resolvedPath, exists });
        if (!exists) {
          throw new Error(
            `SQLite DB file does not exist: ${resolvedPath}. ` +
              `Run POST /api/debug/db/init to create and initialize the database, ` +
              `or ensure a writable dataset is mounted at the path.`,
          );
        }
        try {
          fs.accessSync(resolvedPath, fs.constants.W_OK);
        } catch {
          const dir = require("path").dirname(resolvedPath);
          throw new Error(
            `SQLite DB file is not writable: ${resolvedPath}. The container runs as ` +
              `nextjs:nextjs (uid/gid 1001:1001, see Dockerfile) — fix ownership on the ` +
              `mounted host directory (not "app", which doesn't exist in this image): ` +
              `chown -R 1001:1001 ${dir} && chmod -R 770 ${dir}`,
          );
        }
      }

      // Prisma 7 requires a driver adapter to provide the database connection
      try {
        const adapter = new PrismaBetterSqlite3({ url: dbUrl });
        const rawClient = new PrismaClient({
          adapter,
          // A stored contract is a PDF of up to 20 MB, and many queries read whole lease rows:
          // the ledger, notifications, bank matching, every lease list. Only the contract's own
          // route (app/api/leases/[id]/contract) wants the bytes, and it asks with `select`,
          // which a global omit does not touch.
          omit: { lease: { contractFile: true } },
        });
        // Transparent PII field encryption/decryption — see pii-extension.ts.
        // The extension only transforms field VALUES at runtime; it doesn't
        // change the client's query/return shapes, so this cast is safe.
        globalForPrisma.prisma = rawClient.$extends(
          piiEncryptionExtension,
        ) as unknown as PrismaClient;
        logger.debug("PrismaClient constructed successfully");

        // Validate connection with a quick query
        try {
          (
            globalForPrisma.prisma as unknown as {
              $queryRawUnsafe: (q: string) => Promise<unknown>;
            }
          ).$queryRawUnsafe("SELECT 1");
        } catch {
          logger.warn("Database connection check skipped or failed — queries may fail at runtime");
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          "Failed to construct PrismaClient",
          err instanceof Error ? err : new Error(message),
        );
        throw new Error(`Prisma initialization failed: ${message}`);
      }
    } else {
      // During build time, create a mock client that throws an error if used
      globalForPrisma.prisma = new Proxy({} as PrismaClient, {
        get: (target, prop) => {
          if (prop === "$connect" || prop === "$disconnect") {
            return () => Promise.resolve();
          }
          throw new Error("PrismaClient not available during build time");
        },
      });
    }
  }
  return globalForPrisma.prisma;
}

export { getPrismaClient };
// Remove the default prisma export to prevent build-time initialization
// export const prisma = getPrismaClient();

// Domain service implementations have been extracted into dedicated modules
// under lib/services/database/* and routes now import from those modules
// directly. This file remains the Prisma client and test-helper surface.

// Test helper: allow tests to inject a PrismaClient instance so they can run without a real DB.
// This is intentionally export-only for tests and guarded by an environment check.
export function setPrismaClientForTests(client: PrismaClient | undefined) {
  if (process.env.NODE_ENV !== "test") {
    console.debug("[database] setPrismaClientForTests called outside NODE_ENV=test");
  }
  globalForPrisma.prisma = client;
}

export function resetPrismaClientForTests() {
  if (process.env.NODE_ENV !== "test") {
    console.debug("[database] resetPrismaClientForTests called outside NODE_ENV=test");
  }
  // Clear the cached client so subsequent getPrismaClient calls will re-evaluate
  globalForPrisma.prisma = undefined;
}
