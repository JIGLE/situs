/**
 * Barrel export for all validation schemas
 *
 * Centralized exports for easy importing:
 * import { propertySchema, tenantSchema } from '@/lib/schemas';
 */

// Property schemas
export {
  propertySchema,
  createPropertySchema,
  updatePropertySchema,
  type Property,
  type CreateProperty,
  type UpdateProperty,
} from "./property.schema";

// Tenant schemas
export {
  tenantSchema,
  createTenantSchema,
  updateTenantSchema,
  type Tenant,
  type TenantFormData,
  type CreateTenant,
  type UpdateTenant,
} from "./tenant.schema";

// Lease schemas
export {
  leaseSchema,
  createLeaseSchema,
  updateLeaseSchema,
  type Lease,
  type LeaseFormData,
  type CreateLease,
  type UpdateLease,
} from "./lease.schema";

// Invoice schemas
export {
  invoiceSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  type Invoice,
  type InvoiceFormData,
  type CreateInvoice,
  type UpdateInvoice,
} from "./invoice.schema";

// Payment schemas
export {
  paymentSchema,
  createPaymentSchema,
  updatePaymentSchema,
  type Payment,
  type CreatePayment,
  type UpdatePayment,
} from "./payment.schema";

// Receipt schemas
export {
  receiptSchema,
  createReceiptSchema,
  updateReceiptSchema,
  type Receipt,
  type ReceiptFormData,
  type CreateReceipt,
  type UpdateReceipt,
} from "./receipt.schema";

// Owner schemas
export {
  ownerSchema,
  createOwnerSchema,
  updateOwnerSchema,
  type Owner,
  type OwnerFormData,
  type CreateOwner,
  type UpdateOwner,
} from "./owner.schema";

// Expense schemas
export {
  expenseSchema,
  createExpenseSchema,
  updateExpenseSchema,
  type Expense,
  type ExpenseFormData,
  type CreateExpense,
  type UpdateExpense,
} from "./expense.schema";

// Settings schema
export { settingsSchema, type Settings, type SettingsFormData } from "./settings.schema";

// Document schemas
export {
  documentSchema,
  documentUpdateSchema,
  type Document,
  type DocumentFormData,
  type DocumentUpdate,
  type DocumentUpdateFormData,
} from "./document.schema";

// Late fee config schema
export {
  lateFeeConfigSchema,
  type LateFeeConfig,
  type LateFeeConfigFormData,
} from "./late-fee-config.schema";

// Lease template data schema
export {
  leaseTemplateDataSchema,
  type LeaseTemplateData,
  type LeaseTemplateDataFormData,
} from "./lease-template-data.schema";
