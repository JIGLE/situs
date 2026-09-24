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
  description?: string;
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
  createdAt: string;
  updatedAt: string;
}

// Initial empty data
export const initialProperties: Property[] = [];
export const initialTenants: Tenant[] = [];
export const initialOwners: Owner[] = [];
export const initialReceipts: Receipt[] = [];
export const initialExpenses: Expense[] = [];
