/**
 * The accounts the owner has confirmed pay a tenant's rent.
 *
 * A confirmation is the owner saying "this movement is that tenant's rent", and the account it came
 * from is then remembered for that tenant: the next movement from it, for the same amount as the
 * rent, is matched on its own (`learned_account`, lib/services/matching/engine.ts). Nothing is
 * learned from a guess, only from what a person confirmed, and the owner can forget an account.
 *
 * Only the IBAN's hash is stored, the same hash a movement carries, so matching never needs the IBAN.
 * The last four digits are kept to tell two accounts apart, taken from the movement's encrypted IBAN
 * once, when the account is learned.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { ResourceNotFoundError } from "@/lib/utils/error-handling";
import { decryptPII, UNREADABLE_PII } from "@/lib/utils/pii-encryption";

/** What the owner sees of an account. */
export interface PayerAccountSummary {
  id: string;
  ibanLast4: string | null;
  holderName: string | null;
  createdAt: Date;
}

/** The movement a confirmation is about, as stored. */
export interface ConfirmedMovement {
  id: string;
  counterpartyName: string | null;
  /** As stored: encrypted. */
  counterpartyIban: string | null;
  counterpartyIbanHash: string | null;
}

/** The last four digits of a stored IBAN, or null when it cannot be read. */
function lastFour(storedIban: string | null): string | null {
  if (!storedIban) return null;
  const plain = decryptPII(storedIban);
  if (plain === UNREADABLE_PII) return null;
  const compact = plain.replace(/\s+/g, "");
  return compact.length >= 4 ? compact.slice(-4) : null;
}

/** Whether Prisma refused a write because the row is already there. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

/**
 * Remember the account a confirmed movement came from, for the tenant it was confirmed as. True when
 * the account is new for that tenant, false when it was known already or the movement has no account
 * to remember. A tenant that is not the caller's is not touched.
 */
export async function rememberPayerAccount(
  userId: string,
  tenantId: string,
  movement: ConfirmedMovement,
): Promise<boolean> {
  if (!movement.counterpartyIbanHash) return false;
  const prisma = getPrismaClient();

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, userId },
    select: { id: true },
  });
  if (!tenant) return false;

  const ibanLast4 = lastFour(movement.counterpartyIban);
  let created: { id: string };
  try {
    created = await prisma.payerAccount.create({
      data: {
        userId,
        tenantId,
        ibanHash: movement.counterpartyIbanHash,
        ibanLast4,
        holderName: movement.counterpartyName,
        sourceTransactionId: movement.id,
      },
      select: { id: true },
    });
  } catch (error) {
    // The unique key is the tenant and the account: a second confirmation of it teaches nothing.
    if (isUniqueViolation(error)) return false;
    throw error;
  }

  await logAudit({
    userId,
    action: "REMEMBER_PAYER_ACCOUNT",
    resourceType: "payer_account",
    resourceId: created.id,
    details: { tenantId, ibanLast4, transactionId: movement.id },
  });
  return true;
}

/** The accounts remembered for one tenant of the caller's, oldest first. */
export async function payerAccountsFor(
  userId: string,
  tenantId: string,
): Promise<PayerAccountSummary[]> {
  return getPrismaClient().payerAccount.findMany({
    where: { userId, tenantId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, ibanLast4: true, holderName: true, createdAt: true },
  });
}

/**
 * Forget one account of one tenant. It is one 404 whether the account is not there, belongs to
 * another tenant or to another account of the instance, so the answer says nothing about which.
 */
export async function forgetPayerAccount(
  userId: string,
  tenantId: string,
  accountId: string,
): Promise<void> {
  const prisma = getPrismaClient();
  const account = await prisma.payerAccount.findFirst({
    where: { id: accountId, tenantId, userId },
    select: { id: true, ibanLast4: true },
  });
  if (!account) throw new ResourceNotFoundError("Payer account");

  const { count } = await prisma.payerAccount.deleteMany({
    where: { id: account.id, tenantId, userId },
  });
  // Gone between the read and the delete: someone else forgot it, which is what was asked.
  if (count === 0) return;

  await logAudit({
    userId,
    action: "FORGET_PAYER_ACCOUNT",
    resourceType: "payer_account",
    resourceId: account.id,
    details: { tenantId, ibanLast4: account.ibanLast4 },
  });
}

/** The hashes of the accounts remembered for each of the caller's tenants, for the matching engine. */
export async function learnedHashesByTenant(userId: string): Promise<Map<string, string[]>> {
  const rows = await getPrismaClient().payerAccount.findMany({
    where: { userId },
    select: { tenantId: true, ibanHash: true },
  });
  const byTenant = new Map<string, string[]>();
  for (const { tenantId, ibanHash } of rows) {
    byTenant.set(tenantId, [...(byTenant.get(tenantId) ?? []), ibanHash]);
  }
  return byTenant;
}
