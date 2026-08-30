"use client";

/** Currency codes supported by the application (mirrors the Prisma Currency enum). */
export type Currency = "EUR" | "DKK" | "USD" | "GBP";

/** User fiscal profile (Wave 2.2) */
export interface User {
  id: string;
  name?: string;
  email: string;
  emailVerified?: string;
  image?: string;
  imageConsent?: boolean;
  role: "USER" | "ADMIN" | "MANAGER";
  // Fiscal identity
  fiscalResidency?: string; // ISO country code: "PT", "ES", "IT", "FR", etc.
  nhrStatus: boolean; // PT Non-Habitual Resident (pre-2024)
  nhrYear?: number; // Year NHR status was granted
  ificiStatus: boolean; // PT IFICI regime (from 2024, replaces NHR)
  ificiYear?: number; // Year IFICI status was granted
  createdAt: string;
  updatedAt: string;
}

export interface Building {
  id: string;
  userId: string;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Property {
  id: string;
  userId: string;
  name: string;
  address: string;
  // Enhanced address fields
  streetAddress?: string;
  city?: string;
  zipCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  addressVerified?: boolean;
  // Building grouping
  buildingId?: string;
  buildingName?: string;

  type: "apartment" | "house" | "condo" | "townhouse" | "commercial" | "other";
  bedrooms: number;
  bathrooms: number;
  rent: number;
  status: "occupied" | "vacant" | "maintenance";
  description?: string;
  image?: string;
  // Fiscal / rental regime (Wave 2.2)
  rentalRegime?: string; // "standard" | "acessivel" | "al" | "short_term"
  propertyCountry?: string; // ISO country code (defaults to "PT")
  createdAt: string;
  updatedAt: string;
}

export interface Tenant {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  propertyId?: string;
  propertyName?: string;
  /** @deprecated Derive from active lease's monthlyRent via getActiveLease() */
  rent: number;
  /** @deprecated Derive from active lease's startDate via getActiveLease() */
  leaseStart: string;
  /** @deprecated Derive from active lease's endDate via getActiveLease() */
  leaseEnd: string;
  paymentStatus: "paid" | "overdue" | "pending";
  lastPayment?: string;
  notes?: string;
  /** BCP 47, one of the four catalogues. Null/absent = derive from the property's country. */
  locale?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Receipt {
  id: string;
  number?: string;
  userId: string;
  tenantId: string;
  tenantName: string;
  propertyId: string;
  propertyName: string;
  leaseId?: string;
  amount: number;
  date: string;
  type: "rent" | "deposit" | "maintenance" | "other";
  status: "paid" | "pending";
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CorrespondenceTemplate {
  id: string;
  name: string;
  type:
    | "welcome"
    | "rent_reminder"
    | "eviction_notice"
    | "maintenance_request"
    | "lease_renewal"
    | "custom";
  subject: string;
  content: string;
  variables: string[];
  /** null for system templates — shipped with the product, readable by all, editable by none. */
  userId?: string | null;
  /** Convenience mirror of `userId === null`, so the UI does not have to reason about nulls. */
  isSystem?: boolean;
  /** ISO 3166-1 alpha-2. A statutory notice is only valid in its own jurisdiction. */
  country?: string | null;
  /** BCP 47. A Portuguese notice has to be written in Portuguese. */
  locale?: string | null;
  /** Bumped on every edit; sent letters pin the version they rendered from. */
  version?: number;
  /** Set when this row was copied from another template — the liability record. */
  derivedFromId?: string | null;
  derivedFromVersion?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Correspondence {
  id: string;
  userId: string;
  /** Nullable: a template may be deleted long after the letters it produced were served. */
  templateId: string | null;
  tenantId: string;
  tenantName: string;
  propertyId?: string;
  subject: string;
  content: string;
  status: "draft" | "sent" | "delivered";
  sentAt?: string;
  /**
   * Provenance captured at render time. `subject` and `content` above already hold the words that
   * went out; these say whose words they were, so the record stands alone as evidence.
   */
  templateNameSnapshot?: string | null;
  templateVersionSnapshot?: number | null;
  /** "system" = rendered from a locked statutory template; "user" = from the sender's own copy. */
  templateOriginSnapshot?: "system" | "user" | null;
  createdAt: string;
  updatedAt: string;
}

export interface Owner {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  properties?: PropertyOwner[];
}

export interface PropertyOwner {
  id: string;
  propertyId: string;
  property?: Property;
  ownerId: string;
  ownershipPercentage: number;
  createdAt: string;
  updatedAt: string;
}

export interface Lease {
  id: string;
  userId: string;
  propertyId: string;
  propertyName?: string;
  property?: {
    name: string;
    address: string;
  };
  tenantId: string;
  tenantName?: string;
  tenant?: {
    name: string;
    email: string;
  };
  unitId?: string;
  unitName?: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  deposit: number;
  currency?: string;
  contractFile?: Buffer;
  contractFileName?: string;
  contractFileSize?: number;
  taxRegime?: string;
  status: "active" | "expiring" | "expired" | "terminated" | "pending" | "draft";
  autoRenew: boolean;
  renewalNoticeDays: number;
  notes?: string;
  renewalStatus?: "offered" | "accepted" | "declined" | "expired" | null;
  renewalOfferedAt?: string | null;
  renewalRespondedAt?: string | null;
  renewalNotes?: string | null;
  renewalProposedRent?: number | null;
  renewalStartDate?: string | null;
  renewalEndDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  userId: string;
  propertyId: string;
  propertyName?: string;
  amount: number;
  date: string;
  category: string;
  description?: string;
  documentId?: string | null;
  taxReviewStatus?: string;
  isDeductible?: boolean;
  vendorName?: string;
  vendorVat?: string;
  // Recurring expense fields (Wave 2.4)
  isRecurring?: boolean;
  recurrenceRule?: "monthly" | "quarterly" | "annual";
  recurrenceDay?: number;
  recurrenceEnd?: string | null;
  parentExpenseId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MaintenanceStatus = "open" | "in_progress" | "resolved" | "closed";
export type MaintenancePriority = "low" | "medium" | "high" | "urgent";

export interface MaintenanceTicket {
  id: string;
  userId: string;
  propertyId: string;
  propertyName?: string;
  tenantId?: string;
  tenantName?: string;
  unitId?: string;
  title: string;
  description: string;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  category?: string;
  images?: string[];
  cost?: number; // @deprecated — use estimatedCost
  estimatedCost?: number;
  actualCost?: number;
  scheduledDate?: string;
  dueDate?: string;
  assignedTo?: string; // @deprecated — use vendorName
  vendorName?: string;
  vendorPhone?: string;
  invoiceRef?: string;
  isTenantReport?: boolean;
  resolvedAt?: string;
  evidenceRequired?: boolean;
  slaDueAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Initial empty data
export const initialProperties: Property[] = [];
export const initialTenants: Tenant[] = [];
export const initialOwners: Owner[] = [];
export const initialReceipts: Receipt[] = [];
export const initialExpenses: Expense[] = [];
export const initialMaintenance: MaintenanceTicket[] = [];
export const initialTemplates: CorrespondenceTemplate[] = [
  {
    id: "welcome-template",
    name: "Welcome Letter",
    type: "welcome",
    subject: "Welcome to {{property_name}}",
    content: `Dear {{tenant_name}},

Welcome to {{property_name}}! We're excited to have you as our tenant.

Your lease begins on {{lease_start}} and runs through {{lease_end}}.

Property Details:
- Address: {{property_address}}
- Monthly Rent: $\{{rent_amount}}
- Bedrooms: {{bedrooms}}
- Bathrooms: {{bathrooms}}

Please don't hesitate to contact us if you need anything.

Best regards,
Property Management Team`,
    variables: [
      "tenant_name",
      "property_name",
      "lease_start",
      "lease_end",
      "property_address",
      "rent_amount",
      "bedrooms",
      "bathrooms",
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "rent-reminder-template",
    name: "Rent Payment Reminder",
    type: "rent_reminder",
    subject: "Rent Payment Due - {{property_name}}",
    content: `Dear {{tenant_name}},

This is a friendly reminder that your rent payment of $\{{rent_amount}} for {{property_name}} is due on {{due_date}}.

Please ensure payment is made by the due date to avoid any late fees.

Payment can be made via:
- Bank transfer to: [Account details]
- Online portal: [Portal link]
- Check mailed to: [Mailing address]

If you have already made this payment, please disregard this notice.

Thank you for your prompt attention to this matter.

Best regards,
Property Management Team`,
    variables: ["tenant_name", "property_name", "rent_amount", "due_date"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
export const initialCorrespondence: Correspondence[] = [];
