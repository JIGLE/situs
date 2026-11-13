"use client";

export interface User {
  id: string;
  name?: string;
  email: string;
  emailVerified?: string;
  image?: string;
  imageConsent?: boolean;
  role: "USER" | "ADMIN" | "MANAGER";
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
  /** How exactly the coordinates place it; "area" is only its postal code or town. */
  locationPrecision?: "exact" | "street" | "area" | "pinned" | null;
  // Building grouping
  buildingId?: string | null;
  /** The fração's permilagem (‰) in its building, what a building expense is split by. */
  permilage?: number | null;
  buildingName?: string;

  type: "apartment" | "house" | "condo" | "townhouse" | "commercial" | "other";
  bedrooms: number | null;
  bathrooms: number | null;
  rent: number;
  status: "occupied" | "vacant" | "maintenance";
  description?: string;
  image?: string;
  // Fiscal / rental regime (Wave 2.2)
  rentalRegime?: string; // "standard" | "acessivel" | "al" | "short_term"
  /** Artigo matricial, and the fração within it. */
  cadasterReference?: string | null;
  fraction?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tenant {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
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
  /** What an AT receipt names the tenant by: a NIF, or a document and its country. */
  taxId?: string | null;
  taxCountry?: string | null;
  idDocument?: string | null;
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
  /**
   * The document state, a `ReceiptLifecycleState` stored as text
   * (`lib/services/receipts/lifecycle.ts`); `status` is the money state.
   */
  lifecycle?: string;
  /** The rent month the payment was allocated to, "YYYY-MM"; null when it paid none. */
  referenceMonth?: string | null;
  /** "automation" for a receipt a matched bank movement created, "manual" otherwise. */
  source?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Owner {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phone?: string;
  address?: string;
  notes?: string;
  /** What AT names the owner by on a receipt: a Portuguese NIF, stored as its nine digits. */
  taxIdentificationNumber?: string | null;
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

/** A yearly rent update decided for a lease (`RentIncrease` in the schema). */
export interface RentIncrease {
  id: string;
  leaseId: string;
  /** The first day of the month the new rent starts. */
  effectiveFrom: string;
  previousRent: number;
  newRent: number;
  percent: number;
  noticeDate?: string | null;
  /** Set once the month arrived and the lease took the new rent. */
  appliedAt?: string | null;
  createdAt: string;
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
    email: string | null;
  };
  startDate: string;
  endDate: string;
  monthlyRent: number;
  deposit: number;
  /** The stored contract's name and size. Its bytes come only from /api/leases/[id]/contract. */
  contractFileName?: string | null;
  contractFileSize?: number | null;
  /** AT's number for the contract, and the version after a change. */
  atContractNumber?: string | null;
  atContractVersion?: number | null;
  /** Co-tenants and guarantors: everyone on the lease besides its main tenant. */
  parties?: LeaseParty[];
  /** The rent's updates, oldest first; one with no `appliedAt` has yet to start. */
  rentIncreases?: RentIncrease[];
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

export interface LeaseParty {
  id?: string;
  role: "tenant" | "guarantor";
  name: string;
  taxId?: string | null;
  taxCountry?: string | null;
  idDocument?: string | null;
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
  /** A co-owner who paid it themselves; the year's shares give it back to them. */
  paidByOwnerId?: string | null;
  /** The bank movement that paid it, when one did. */
  bankTransactionId?: string | null;
  /** A recurring month the bank should have shown being paid by now, and did not. */
  notSeenInBank?: boolean;
  /** The building expense this is one unit's part of; it is changed through the building. */
  buildingExpenseId?: string | null;
  building?: { id: string; name: string; totalAmount: number } | null;
  createdAt: string;
  updatedAt: string;
}

// Initial empty data
export const initialProperties: Property[] = [];
export const initialTenants: Tenant[] = [];
export const initialOwners: Owner[] = [];
export const initialReceipts: Receipt[] = [];
export const initialExpenses: Expense[] = [];
