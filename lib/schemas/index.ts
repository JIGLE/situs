/**
 * Barrel export for all validation schemas
 *
 * Centralized exports for easy importing:
 * import { propertySchema, tenantSchema } from '@/lib/schemas';
 */

// Lease template data schema
export {
  leaseTemplateDataSchema,
  type LeaseTemplateData,
  type LeaseTemplateDataFormData,
} from "./lease-template-data.schema";
