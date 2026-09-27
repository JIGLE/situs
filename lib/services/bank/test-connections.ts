import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { isTestConnection } from "@/lib/services/bank/metadata";
import { revokeAtBank } from "@/lib/services/bank/connections";

/**
 * The lifecycle of a connection made to prove the chain works.
 *
 * A test connection is an ordinary connection with a marker in its metadata — same consent, same
 * provider calls, same import pipeline. What is special is only that it is disposable, and this
 * module is the disposing.
 *
 * Deletion is offered for test connections and refused for real ones. That is not squeamishness:
 * removing a real connection would take its accounts and every movement ever imported through it
 * with them, and the place to make a decision that size is not a diagnostics panel.
 */

export class TestConnectionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TestConnectionError";
  }
}

export interface TestConnectionRow {
  id: string;
  institutionName: string;
  provider: string;
  status: string;
  createdAt: string;
  lastSyncAt: string | null;
  accounts: number;
  movements: number;
}

/** Every test connection belonging to this user, newest first. */
export async function listTestConnections(userId: string): Promise<TestConnectionRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.bankConnection.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { accounts: { select: { id: true, _count: { select: { transactions: true } } } } },
  });

  return rows
    .filter((row) => isTestConnection(row.metadata))
    .map((row) => ({
      id: row.id,
      institutionName: row.institutionName,
      provider: row.provider,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      accounts: row.accounts.length,
      movements: row.accounts.reduce((sum, account) => sum + account._count.transactions, 0),
    }));
}

/**
 * Remove a test connection and everything the schema cascades from it: its accounts, and the
 * movements under those accounts.
 *
 * No `Receipt` can be caught in that cascade, and that is by construction rather than by luck —
 * `importBankRows` refuses to allocate rows arriving through a test connection, precisely so this
 * delete cannot strand a receipt whose movement no longer exists.
 */
export async function deleteTestConnection(
  userId: string,
  connectionId: string,
): Promise<{ accounts: number; movements: number }> {
  const prisma = getPrismaClient();

  // Scoped by userId in the same query that fetches it, so another account's connection is
  // "not found" rather than "forbidden" — it should not be discoverable either way.
  const connection = await prisma.bankConnection.findFirst({
    where: { id: connectionId, userId },
    include: { accounts: { select: { id: true, _count: { select: { transactions: true } } } } },
  });

  if (!connection) {
    throw new TestConnectionError("Bank connection not found", 404);
  }
  if (!isTestConnection(connection.metadata)) {
    throw new TestConnectionError(
      "That is not a test connection. Real connections are removed from Settings › Integrations, " +
        "where the consequences are stated in full.",
      400,
    );
  }

  const removed = {
    accounts: connection.accounts.length,
    movements: connection.accounts.reduce((sum, account) => sum + account._count.transactions, 0),
  };

  await prisma.bankConnection.delete({ where: { id: connection.id } });

  // The consent it held is ended at the bank too, once the row is gone. Best effort, as for a
  // real connection: the outcome is recorded, never raised.
  const revocation = await revokeAtBank(connection.provider, connection.consentId);

  await logAudit({
    userId,
    action: "BANK_CONNECTION_DELETED",
    resourceType: "bank_connection",
    resourceId: connection.id,
    details: { institutionName: connection.institutionName, isTest: true, ...removed, revocation },
  });

  return removed;
}
