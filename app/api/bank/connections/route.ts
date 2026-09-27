import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";
import {
  configuredProviders,
  getProviderForConnection,
} from "@/lib/services/bank/providers/registry";
import { remainingBudget } from "@/lib/services/bank/sync";
import { canDisconnect } from "@/lib/services/bank/connections";

export const runtime = "nodejs";

/**
 * Bank connection status for the Settings > Integrations hub.
 * Mirrors GET /api/tax/connectors' shape/style.
 *
 * Two kinds of row come back through here and they are not interchangeable: the `manual` and
 * `csv` connections the import pipeline find-or-creates, which can only ever receive uploaded
 * files, and `psd2_*` connections to a real bank, which can be synced. `canSync` and
 * `remainingBudget` are computed here rather than inferred in the UI from the provider string,
 * so a button that spends a rate-limited API call cannot be rendered next to a row that has no
 * API behind it.
 *
 * `providersConfigured` is the list the UI must consult before offering to connect anything. It
 * is empty both when no adapter ships — the current state — and when one ships without
 * credentials, and the UI treats those the same way: no connect button, and how to configure one.
 *
 * What the owner can do with each connection is decided here too: `canRenew`, `canDisconnect`,
 * `revocable` (whether disconnecting reaches the bank), and `canRemove` (only with no
 * `movements`). Each row is built field by field, because `consentId` is read to decide those and
 * must never be sent.
 */
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const prisma = getPrismaClient();
  const rows = await prisma.bankConnection.findMany({
    where: { userId: scopeUserId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      institutionName: true,
      label: true,
      status: true,
      lastSyncAt: true,
      consentExpiresAt: true,
      consentId: true,
      accounts: { select: { _count: { select: { transactions: true } } } },
    },
  });
  const configured = configuredProviders();

  const connections = await Promise.all(
    rows.map(async (row) => {
      const provider = getProviderForConnection(row.provider);
      const isProvider = Boolean(provider);
      const movements = row.accounts.reduce((sum, account) => sum + account._count.transactions, 0);
      return {
        id: row.id,
        provider: row.provider,
        institutionName: row.institutionName,
        label: row.label,
        status: row.status,
        lastSyncAt: row.lastSyncAt,
        consentExpiresAt: row.consentExpiresAt,
        isProvider,
        canSync: isProvider && row.status === "active",
        remainingBudget: isProvider ? await remainingBudget(row.id, row.provider) : null,
        // As `startRenewal` decides: a bank connection past its first consent, whose provider
        // this instance is configured for.
        canRenew:
          Boolean(provider && configured.includes(provider.key)) &&
          row.status !== "pending_consent",
        canDisconnect: canDisconnect(row),
        revocable: Boolean(row.consentId && provider),
        movements,
        canRemove: movements === 0,
      };
    }),
  );

  return createSuccessResponse({ connections, providersConfigured: configured });
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
