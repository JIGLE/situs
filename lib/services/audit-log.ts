import { getPrismaClient } from "@/lib/services/database/database";

/**
 * GDPR-compliant audit logging service
 *
 * Logs user actions for compliance with GDPR Article 30 (Records of processing activities)
 * and Article 5(2) (Accountability principle)
 */

export type AuditAction =
  // Authentication
  | "LOGIN"
  | "LOGOUT"
  | "PASSWORD_CHANGE"
  // Data access
  | "VIEW_PERSONAL_DATA"
  | "EXPORT_PERSONAL_DATA"
  | "DELETE_PERSONAL_DATA"
  // CRUD operations
  | "CREATE_PROPERTY"
  | "UPDATE_PROPERTY"
  | "DELETE_PROPERTY"
  | "CREATE_TENANT"
  | "UPDATE_TENANT"
  | "DELETE_TENANT"
  | "REVOKE_PORTAL_ACCESS"
  | "CREATE_LEASE"
  | "UPDATE_LEASE"
  | "DELETE_LEASE"
  // The signed contract stored on a lease: a document full of personal data, so reading it is
  // recorded as well as changing it.
  | "UPLOAD_LEASE_CONTRACT"
  | "DOWNLOAD_LEASE_CONTRACT"
  | "DELETE_LEASE_CONTRACT"
  | "CREATE_UNIT"
  | "UPDATE_UNIT"
  | "DELETE_UNIT"
  | "CREATE_RECEIPT"
  | "UPDATE_RECEIPT"
  | "DELETE_RECEIPT"
  | "CREATE_EXPENSE"
  | "UPDATE_EXPENSE"
  | "DELETE_EXPENSE"
  | "SEND_EMAIL"
  // Compliance operations
  | "VIEW_RENT_RECEIPTS"
  | "CREATE_RENT_RECEIPT"
  | "VIEW_OWNERSHIP_VERIFICATIONS"
  | "CREATE_OWNERSHIP_VERIFICATION"
  // Admin actions
  | "DATABASE_ACCESS"
  | "DATABASE_EXPORT"
  | "SETTINGS_CHANGE"
  // Situs reference-month workflow (Migration A)
  | "GENERATE_RENT_PERIODS"
  | "ALLOCATE_PAYMENT"
  | "REVERSE_ALLOCATION"
  // Situs bank layer (Migration B)
  | "IMPORT_BANK_TRANSACTIONS"
  | "MATCH_PAYMENT"
  | "CONFIRM_MATCH"
  | "OVERRIDE_MATCH"
  | "IGNORE_TRANSACTION"
  | "APPLY_RECONCILIATION_RULE"
  // Live bank connection (PSD2 account information)
  | "BANK_CONNECTION_CREATED"
  // Only a connection marked as a test can be deleted, so this action always describes a
  // discarded test run — never the removal of a bank someone relies on.
  | "BANK_CONNECTION_DELETED"
  | "BANK_CONSENT_GRANTED"
  | "BANK_CONSENT_EXPIRED"
  // Situs receipt lifecycle + tax connector (Migration C)
  | "EMIT_RECEIPT"
  | "SUBMIT_RECEIPT"
  | "ARCHIVE_RECEIPT"
  | "VOID_RECEIPT"
  | "TRANSITION_RECEIPT_LIFECYCLE"
  // The AT connection: the Portal sub-user Situs signs in as, the connector's mode, and a receipt
  // fetched from AT (it names the tenant, so reading it is recorded).
  | "SET_TAX_CREDENTIALS"
  | "REMOVE_TAX_CREDENTIALS"
  | "SET_TAX_CONNECTOR_MODE"
  | "FETCH_AT_RECEIPT"
  // Situs Documents/OCR (Migration D)
  | "OCR_CLASSIFY_DOCUMENT"
  | "OCR_EXTRACTION_REVIEWED"
  | "LINK_EXPENSE_DOCUMENT"
  // Property ownership assignment
  | "ASSIGN_PROPERTY_OWNER"
  | "REMOVE_PROPERTY_OWNER";

export interface AuditLogEntry {
  userId: string;
  action: AuditAction;
  details?: string | Record<string, unknown>;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log an audit entry for GDPR compliance
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    const prisma = getPrismaClient();

    // Serialize details if it's an object
    const details =
      typeof entry.details === "object" ? JSON.stringify(entry.details) : entry.details;

    await prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        details: details || null,
        resourceType: entry.resourceType || null,
        resourceId: entry.resourceId || null,
      },
    });

    // Optional: Log to console in development
    if (process.env.NODE_ENV === "development") {
      console.debug(`[Audit] ${entry.action} by user ${entry.userId}`, entry.details || "");
    }
  } catch (error) {
    // Don't throw - audit logging should not break the main flow
    console.error(
      "[Audit] Failed to log entry:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Get audit logs for a user (for GDPR data export)
 */
export async function getAuditLogsForUser(userId: string): Promise<
  {
    action: string;
    details: string | null;
    createdAt: Date;
  }[]
> {
  const prisma = getPrismaClient();

  return prisma.auditLog.findMany({
    where: { userId },
    select: {
      action: true,
      details: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Delete audit logs for a user (for GDPR right to erasure)
 * Note: Some audit logs may need to be retained for legal compliance
 */
export async function deleteAuditLogsForUser(userId: string): Promise<number> {
  const prisma = getPrismaClient();

  const result = await prisma.auditLog.deleteMany({
    where: { userId },
  });

  return result.count;
}

/**
 * Helper to create audit middleware for API routes
 */
export function createAuditMiddleware(action: AuditAction, resourceType?: string) {
  return async (userId: string, resourceId?: string, details?: Record<string, unknown>) => {
    await logAudit({
      userId,
      action,
      resourceType,
      resourceId,
      details,
    });
  };
}
