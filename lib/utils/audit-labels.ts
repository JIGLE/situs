import type { AuditAction } from "@/lib/services/audit-log";

/**
 * Catalogue key for an audit action, under the `auditActions` namespace.
 *
 * The audit trail printed the stored action with its underscores removed, "UPLOAD LEASE
 * CONTRACT" in a Portuguese screen: a stored enum is not a label. The `Record` type makes a new
 * `AuditAction` without a label a compile error rather than a code that renders as itself.
 */
export const AUDIT_ACTION_KEY = {
  LOGIN: "login",
  LOGOUT: "logout",
  PASSWORD_CHANGE: "passwordChange",
  VIEW_PERSONAL_DATA: "viewPersonalData",
  EXPORT_PERSONAL_DATA: "exportPersonalData",
  DELETE_PERSONAL_DATA: "deletePersonalData",
  CREATE_PROPERTY: "createProperty",
  UPDATE_PROPERTY: "updateProperty",
  DELETE_PROPERTY: "deleteProperty",
  CREATE_TENANT: "createTenant",
  UPDATE_TENANT: "updateTenant",
  DELETE_TENANT: "deleteTenant",
  REVOKE_PORTAL_ACCESS: "revokePortalAccess",
  CREATE_LEASE: "createLease",
  UPDATE_LEASE: "updateLease",
  DELETE_LEASE: "deleteLease",
  UPLOAD_LEASE_CONTRACT: "uploadLeaseContract",
  DOWNLOAD_LEASE_CONTRACT: "downloadLeaseContract",
  DELETE_LEASE_CONTRACT: "deleteLeaseContract",
  CREATE_UNIT: "createUnit",
  UPDATE_UNIT: "updateUnit",
  DELETE_UNIT: "deleteUnit",
  CREATE_RECEIPT: "createReceipt",
  UPDATE_RECEIPT: "updateReceipt",
  DELETE_RECEIPT: "deleteReceipt",
  CREATE_EXPENSE: "createExpense",
  UPDATE_EXPENSE: "updateExpense",
  DELETE_EXPENSE: "deleteExpense",
  SEND_EMAIL: "sendEmail",
  VIEW_RENT_RECEIPTS: "viewRentReceipts",
  CREATE_RENT_RECEIPT: "createRentReceipt",
  VIEW_OWNERSHIP_VERIFICATIONS: "viewOwnershipVerifications",
  CREATE_OWNERSHIP_VERIFICATION: "createOwnershipVerification",
  DATABASE_ACCESS: "databaseAccess",
  DATABASE_EXPORT: "databaseExport",
  SETTINGS_CHANGE: "settingsChange",
  GENERATE_RENT_PERIODS: "generateRentPeriods",
  ALLOCATE_PAYMENT: "allocatePayment",
  REVERSE_ALLOCATION: "reverseAllocation",
  IMPORT_BANK_TRANSACTIONS: "importBankTransactions",
  MATCH_PAYMENT: "matchPayment",
  CONFIRM_MATCH: "confirmMatch",
  OVERRIDE_MATCH: "overrideMatch",
  IGNORE_TRANSACTION: "ignoreTransaction",
  APPLY_RECONCILIATION_RULE: "applyReconciliationRule",
  BANK_CONNECTION_CREATED: "bankConnectionCreated",
  BANK_CONNECTION_DELETED: "bankConnectionDeleted",
  BANK_CONSENT_GRANTED: "bankConsentGranted",
  BANK_CONSENT_EXPIRED: "bankConsentExpired",
  EMIT_RECEIPT: "emitReceipt",
  SUBMIT_RECEIPT: "submitReceipt",
  ARCHIVE_RECEIPT: "archiveReceipt",
  VOID_RECEIPT: "voidReceipt",
  TRANSITION_RECEIPT_LIFECYCLE: "transitionReceiptLifecycle",
  OCR_CLASSIFY_DOCUMENT: "ocrClassifyDocument",
  OCR_EXTRACTION_REVIEWED: "ocrExtractionReviewed",
  LINK_EXPENSE_DOCUMENT: "linkExpenseDocument",
  ASSIGN_PROPERTY_OWNER: "assignPropertyOwner",
  REMOVE_PROPERTY_OWNER: "removePropertyOwner",
} as const satisfies Record<AuditAction, string>;

/**
 * The label key for a stored action, or null for one no longer written. Rows outlive the code
 * that wrote them: an action from a removed feature has no label, and the trail shows its code.
 */
export function auditActionKey(action: string): (typeof AUDIT_ACTION_KEY)[AuditAction] | null {
  return Object.hasOwn(AUDIT_ACTION_KEY, action) ? AUDIT_ACTION_KEY[action as AuditAction] : null;
}
