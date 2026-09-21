/**
 * Mock Database Services
 * Read-only in-memory fixtures for development without DATABASE_URL
 */

import type {
  Property,
  Tenant,
  Receipt,
  CorrespondenceTemplate,
  Correspondence,
  Owner,
  Lease,
  Expense,
} from "@/lib/types";

// Minimal MaintenanceContact type used by mock data (not exported from '@/lib/types')
type MaintenanceContact = {
  id: string;
  userId: string;
  name: string;
  company?: string;
  type: string;
  specialties?: string[];
  email?: string;
  phone?: string;
  address?: string;
  hourlyRate?: number;
  currency?: string;
  rating?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

// Mock data stores - read-only
const MOCK_PROPERTIES = [
  {
    id: "prop-1",
    userId: "mock-user",
    name: "Sunset Apartments",
    address: "123 Main Street, Los Angeles, CA 90001",
    streetAddress: "123 Main Street",
    city: "Los Angeles",
    zipCode: "90001",
    country: "United States",
    type: "apartment",
    status: "occupied",
    bedrooms: 2,
    bathrooms: 2,
    createdAt: "2024-01-15T10:00:00Z",
    updatedAt: "2025-12-01T14:30:00Z",
  },
  {
    id: "prop-2",
    userId: "mock-user",
    name: "Downtown Office Suite",
    address: "456 Business Blvd, New York, NY 10001",
    streetAddress: "456 Business Blvd",
    city: "New York",
    zipCode: "10001",
    country: "United States",
    type: "commercial",
    status: "occupied",
    createdAt: "2024-03-20T09:00:00Z",
    updatedAt: "2025-11-15T16:45:00Z",
  },
  {
    id: "prop-3",
    userId: "mock-user",
    name: "Riverside House",
    address: "789 River Road, Portland, OR 97201",
    streetAddress: "789 River Road",
    city: "Portland",
    zipCode: "97201",
    country: "United States",
    type: "house",
    status: "vacant",
    bedrooms: 3,
    bathrooms: 2.5,
    createdAt: "2024-06-10T11:30:00Z",
    updatedAt: "2026-01-20T08:15:00Z",
  },
  {
    id: "prop-4",
    userId: "mock-user",
    name: "Marina View Condo",
    address: "321 Harbor Lane, Miami, FL 33101",
    streetAddress: "321 Harbor Lane",
    city: "Miami",
    zipCode: "33101",
    country: "United States",
    type: "apartment",
    status: "occupied",
    bedrooms: 2,
    bathrooms: 2,
    createdAt: "2024-08-05T13:20:00Z",
    updatedAt: "2025-12-28T10:00:00Z",
  },
];

const MOCK_TENANTS = [
  {
    id: "tenant-1",
    userId: "mock-user",
    propertyId: "prop-1",
    name: "Sarah Johnson",
    email: "sarah.johnson@email.com",
    phone: "+1-555-0101",
    leaseStart: "2025-01-01",
    leaseEnd: "2026-12-31",
    monthlyRent: 2200,
    securityDeposit: 2200,
    paymentStatus: "current",
    createdAt: "2024-12-15T09:00:00Z",
    updatedAt: "2026-01-05T14:30:00Z",
  },
  {
    id: "tenant-2",
    userId: "mock-user",
    propertyId: "prop-2",
    name: "Tech Startup Inc.",
    email: "billing@techstartup.com",
    phone: "+1-555-0202",
    leaseStart: "2024-06-01",
    leaseEnd: "2027-05-31",
    monthlyRent: 5500,
    securityDeposit: 11000,
    paymentStatus: "current",
    createdAt: "2024-05-20T10:30:00Z",
    updatedAt: "2026-01-02T11:15:00Z",
  },
  {
    id: "tenant-3",
    userId: "mock-user",
    propertyId: "prop-4",
    name: "Michael Chen",
    email: "mchen@email.com",
    phone: "+1-555-0303",
    leaseStart: "2025-03-01",
    leaseEnd: "2026-02-28",
    monthlyRent: 2800,
    securityDeposit: 2800,
    paymentStatus: "overdue",
    createdAt: "2025-02-10T12:00:00Z",
    updatedAt: "2026-02-01T09:20:00Z",
  },
];

const MOCK_RECEIPTS = [
  {
    id: "receipt-1",
    userId: "mock-user",
    propertyId: "prop-1",
    propertyName: "Sunset Apartments",
    type: "rent",
    amount: 2200,
    date: "2026-01-01",
    status: "paid",
    description: "January 2026 Rent",
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-01-01T10:00:00Z",
  },
  {
    id: "receipt-2",
    userId: "mock-user",
    propertyId: "prop-2",
    propertyName: "Downtown Office Suite",
    type: "rent",
    amount: 5500,
    date: "2026-01-01",
    status: "paid",
    description: "January 2026 Rent",
    createdAt: "2026-01-01T09:00:00Z",
    updatedAt: "2026-01-01T09:00:00Z",
  },
  {
    id: "receipt-3",
    userId: "mock-user",
    propertyId: "prop-4",
    propertyName: "Marina View Condo",
    type: "rent",
    amount: 2800,
    date: "2026-02-01",
    status: "pending",
    description: "February 2026 Rent",
    createdAt: "2026-02-01T00:00:00Z",
    updatedAt: "2026-02-01T00:00:00Z",
  },
  {
    id: "receipt-4",
    userId: "mock-user",
    propertyId: "prop-1",
    propertyName: "Sunset Apartments",
    type: "rent",
    amount: 2200,
    date: "2025-12-01",
    status: "paid",
    description: "December 2025 Rent",
    createdAt: "2025-12-01T10:00:00Z",
    updatedAt: "2025-12-01T10:00:00Z",
  },
  {
    id: "receipt-5",
    userId: "mock-user",
    propertyId: "prop-2",
    propertyName: "Downtown Office Suite",
    type: "rent",
    amount: 5500,
    date: "2025-12-01",
    status: "paid",
    description: "December 2025 Rent",
    createdAt: "2025-12-01T09:00:00Z",
    updatedAt: "2025-12-01T09:00:00Z",
  },
  {
    id: "receipt-6",
    userId: "mock-user",
    propertyId: "prop-4",
    propertyName: "Marina View Condo",
    type: "rent",
    amount: 2800,
    date: "2025-12-01",
    status: "paid",
    description: "December 2025 Rent",
    createdAt: "2025-12-01T08:00:00Z",
    updatedAt: "2025-12-01T08:00:00Z",
  },
];

const MOCK_TEMPLATES = [
  {
    id: "template-1",
    userId: "mock-user",
    name: "Rent Reminder",
    subject: "Rent Payment Reminder",
    body: "Dear {{tenant_name}},\n\nThis is a friendly reminder that your rent payment of ${{amount}} is due on {{due_date}}.\n\nThank you,\nProperty Management",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "template-2",
    userId: "mock-user",
    name: "Maintenance Notice",
    subject: "Scheduled Maintenance",
    body: "Dear {{tenant_name}},\n\nWe will be performing scheduled maintenance on {{date}}. Please ensure access to {{area}}.\n\nBest regards,\nMaintenance Team",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];

const MOCK_CORRESPONDENCE = [
  {
    id: "corr-1",
    userId: "mock-user",
    recipientEmail: "sarah.johnson@email.com",
    recipientName: "Sarah Johnson",
    subject: "Welcome to Sunset Apartments",
    body: "Dear Sarah,\n\nWelcome to Sunset Apartments! We are excited to have you as our tenant.\n\nBest regards,\nProperty Management",
    status: "sent",
    sentAt: "2025-01-01T12:00:00Z",
    createdAt: "2025-01-01T11:50:00Z",
    updatedAt: "2025-01-01T12:00:00Z",
  },
];

const MOCK_OWNERS = [
  {
    id: "owner-1",
    userId: "mock-user",
    name: "John Smith",
    email: "john.smith@email.com",
    phone: "+1-555-1001",
    address: "100 Owner Street, Los Angeles, CA 90001",
    status: "active",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2025-06-15T10:00:00Z",
  },
  {
    id: "owner-2",
    userId: "mock-user",
    name: "Real Estate Holdings LLC",
    email: "contact@realestate-llc.com",
    phone: "+1-555-1002",
    address: "200 Corporate Plaza, New York, NY 10001",
    status: "active",
    createdAt: "2024-02-15T00:00:00Z",
    updatedAt: "2025-08-20T14:30:00Z",
  },
];

const MOCK_LEASES = [
  {
    id: "lease-1",
    userId: "mock-user",
    propertyId: "prop-1",
    tenantId: "tenant-1",
    startDate: "2025-01-01",
    endDate: "2026-12-31",
    monthlyRent: 2200,
    securityDeposit: 2200,
    status: "active",
    terms: "Standard residential lease agreement. Tenant responsible for utilities.",
    createdAt: "2024-12-15T09:00:00Z",
    updatedAt: "2025-01-01T10:00:00Z",
  },
  {
    id: "lease-2",
    userId: "mock-user",
    propertyId: "prop-2",
    tenantId: "tenant-2",
    startDate: "2024-06-01",
    endDate: "2027-05-31",
    monthlyRent: 5500,
    securityDeposit: 11000,
    status: "active",
    terms:
      "Commercial lease. Triple net lease. Tenant responsible for taxes, insurance, maintenance.",
    createdAt: "2024-05-20T10:30:00Z",
    updatedAt: "2024-06-01T09:00:00Z",
  },
  {
    id: "lease-3",
    userId: "mock-user",
    propertyId: "prop-4",
    tenantId: "tenant-3",
    startDate: "2025-03-01",
    endDate: "2026-02-28",
    monthlyRent: 2800,
    securityDeposit: 2800,
    status: "active",
    terms: "Standard residential lease. 1-year term with option to renew.",
    createdAt: "2025-02-10T12:00:00Z",
    updatedAt: "2025-03-01T08:00:00Z",
  },
];

const MOCK_EXPENSES = [
  {
    id: "expense-1",
    userId: "mock-user",
    propertyId: "prop-1",
    category: "maintenance",
    amount: 350,
    date: "2026-01-15",
    description: "Plumbing repair - kitchen sink",
    status: "paid",
    createdAt: "2026-01-15T14:00:00Z",
    updatedAt: "2026-01-16T10:00:00Z",
  },
  {
    id: "expense-2",
    userId: "mock-user",
    propertyId: "prop-2",
    category: "utilities",
    amount: 850,
    date: "2026-01-05",
    description: "Electricity bill - December 2025",
    status: "paid",
    createdAt: "2026-01-05T09:00:00Z",
    updatedAt: "2026-01-06T08:00:00Z",
  },
  {
    id: "expense-3",
    userId: "mock-user",
    propertyId: "prop-1",
    category: "insurance",
    amount: 1200,
    date: "2025-12-01",
    description: "Property insurance - Annual premium",
    status: "paid",
    createdAt: "2025-12-01T10:00:00Z",
    updatedAt: "2025-12-01T10:30:00Z",
  },
];

const MOCK_CONTACTS = [
  {
    id: "contact-1",
    userId: "mock-user",
    name: "John's Plumbing Services",
    company: "John's Plumbing",
    type: "plumber",
    specialties: ["Emergency repairs", "Pipe installation", "Water heaters"],
    email: "john@johnsplumbing.com",
    phone: "+1 (555) 123-4567",
    address: "789 Trade St, Los Angeles, CA 90001",
    hourlyRate: 85,
    currency: "USD",
    rating: 4.8,
    notes: "Reliable and quick response time. Available for emergencies.",
    createdAt: "2025-06-15T10:00:00Z",
    updatedAt: "2026-01-10T14:00:00Z",
  },
  {
    id: "contact-2",
    userId: "mock-user",
    name: "ABC Electric",
    company: "ABC Electric Solutions",
    type: "electrician",
    specialties: ["Wiring", "Circuit breakers", "Lighting installation"],
    email: "contact@abcelectric.com",
    phone: "+1 (555) 234-5678",
    address: "456 Electric Ave, New York, NY 10001",
    hourlyRate: 95,
    currency: "USD",
    rating: 4.9,
    notes: "Licensed and insured. Excellent work quality.",
    createdAt: "2025-07-20T09:00:00Z",
    updatedAt: "2025-12-05T16:30:00Z",
  },
  {
    id: "contact-3",
    userId: "mock-user",
    name: "CoolAir HVAC",
    company: "CoolAir Systems Inc.",
    type: "hvac",
    specialties: ["AC repair", "Heating systems", "Maintenance"],
    email: "service@coolair.com",
    phone: "+1 (555) 345-6789",
    address: "123 Climate Dr, Miami, FL 33101",
    hourlyRate: 110,
    currency: "USD",
    rating: 4.7,
    notes: "Specialized in commercial HVAC systems.",
    createdAt: "2025-08-10T11:00:00Z",
    updatedAt: "2026-01-15T10:00:00Z",
  },
  {
    id: "contact-4",
    userId: "mock-user",
    name: "HandyFix Services",
    company: "HandyFix LLC",
    type: "handyman",
    specialties: ["General repairs", "Carpentry", "Painting", "Door/window repair"],
    email: "info@handyfix.com",
    phone: "+1 (555) 456-7890",
    address: "321 Fix-It Lane, Chicago, IL 60601",
    hourlyRate: 65,
    currency: "USD",
    rating: 4.5,
    notes: "Good for small to medium repairs. Flexible scheduling.",
    createdAt: "2025-09-01T08:00:00Z",
    updatedAt: "2025-11-20T13:00:00Z",
  },
  {
    id: "contact-5",
    userId: "mock-user",
    name: "GreenScape Landscaping",
    company: "GreenScape Pro",
    type: "landscaper",
    specialties: ["Lawn maintenance", "Tree trimming", "Irrigation"],
    email: "contact@greenscape.com",
    phone: "+1 (555) 567-8901",
    address: "555 Garden Rd, Portland, OR 97201",
    hourlyRate: 55,
    currency: "USD",
    rating: 4.6,
    notes: "Monthly maintenance contracts available.",
    createdAt: "2025-05-15T07:00:00Z",
    updatedAt: "2025-12-30T09:00:00Z",
  },
];

// Property service
export const propertyService = {
  async getAll(_userId: string): Promise<Property[]> {
    return [...MOCK_PROPERTIES] as unknown as Property[];
  },

  async getById(_userId: string, _id: string): Promise<Property | null> {
    return null;
  },

  async create(_userId: string, _data: Partial<Property>): Promise<Property> {
    throw new Error("Cannot create properties in mock mode. Set DATABASE_URL to enable writes.");
  },

  async update(_userId: string, _id: string, _data: Partial<Property>): Promise<Property> {
    throw new Error("Cannot update properties in mock mode. Set DATABASE_URL to enable writes.");
  },

  async delete(_userId: string, _id: string): Promise<void> {
    throw new Error("Cannot delete properties in mock mode. Set DATABASE_URL to enable writes.");
  },
};

// Tenant service
export const tenantService = {
  async getAll(_userId: string): Promise<Tenant[]> {
    return [...MOCK_TENANTS] as unknown as Tenant[];
  },

  async getById(_userId: string, _id: string): Promise<Tenant | null> {
    return null;
  },

  async getByPropertyId(_userId: string, _propertyId: string): Promise<Tenant[]> {
    return [];
  },

  async create(_userId: string, _data: Partial<Tenant>): Promise<Tenant> {
    throw new Error("Cannot create tenants in mock mode. Set DATABASE_URL to enable writes.");
  },

  async update(_userId: string, _id: string, _data: Partial<Tenant>): Promise<Tenant> {
    throw new Error("Cannot update tenants in mock mode. Set DATABASE_URL to enable writes.");
  },

  async delete(_userId: string, _id: string): Promise<void> {
    throw new Error("Cannot delete tenants in mock mode. Set DATABASE_URL to enable writes.");
  },
};

// Receipt service
export const receiptService = {
  async getAll(_userId: string): Promise<Receipt[]> {
    return [...MOCK_RECEIPTS] as unknown as Receipt[];
  },

  async getById(_userId: string, _id: string): Promise<Receipt | null> {
    return null;
  },

  async getByPropertyId(_userId: string, _propertyId: string): Promise<Receipt[]> {
    return [];
  },

  async create(_userId: string, _data: Partial<Receipt>): Promise<Receipt> {
    throw new Error("Cannot create receipts in mock mode. Set DATABASE_URL to enable writes.");
  },

  async update(_userId: string, _id: string, _data: Partial<Receipt>): Promise<Receipt> {
    throw new Error("Cannot update receipts in mock mode. Set DATABASE_URL to enable writes.");
  },

  async delete(_userId: string, _id: string): Promise<void> {
    throw new Error("Cannot delete receipts in mock mode. Set DATABASE_URL to enable writes.");
  },
};

// Template service
// Signatures mirror the real service exactly — userId first — so mock mode cannot drift into
// accepting calls the scoped implementation would reject.
export const templateService = {
  async getAll(_userId: string): Promise<CorrespondenceTemplate[]> {
    return [...MOCK_TEMPLATES] as unknown as CorrespondenceTemplate[];
  },

  async getById(_userId: string, _id: string): Promise<CorrespondenceTemplate | null> {
    return null;
  },

  async create(
    _userId: string,
    _data: Partial<CorrespondenceTemplate>,
  ): Promise<CorrespondenceTemplate> {
    throw new Error("Cannot create templates in mock mode. Set DATABASE_URL to enable writes.");
  },

  async copyForUser(_userId: string, _id: string): Promise<CorrespondenceTemplate> {
    throw new Error("Cannot copy templates in mock mode. Set DATABASE_URL to enable writes.");
  },

  async update(
    _userId: string,
    _id: string,
    _data: Partial<CorrespondenceTemplate>,
  ): Promise<CorrespondenceTemplate> {
    throw new Error("Cannot update templates in mock mode. Set DATABASE_URL to enable writes.");
  },

  async delete(_userId: string, _id: string): Promise<void> {
    throw new Error("Cannot delete templates in mock mode. Set DATABASE_URL to enable writes.");
  },
};

// Correspondence service
export const correspondenceService = {
  async getAll(_userId: string): Promise<Correspondence[]> {
    return [...MOCK_CORRESPONDENCE] as unknown as Correspondence[];
  },

  async getById(_userId: string, _id: string): Promise<Correspondence | null> {
    return null;
  },

  async create(_userId: string, _data: Partial<Correspondence>): Promise<Correspondence> {
    throw new Error(
      "Cannot create correspondence in mock mode. Set DATABASE_URL to enable writes.",
    );
  },

  async update(
    _userId: string,
    _id: string,
    _data: Partial<Correspondence>,
  ): Promise<Correspondence> {
    throw new Error(
      "Cannot update correspondence in mock mode. Set DATABASE_URL to enable writes.",
    );
  },

  async delete(_userId: string, _id: string): Promise<void> {
    throw new Error(
      "Cannot delete correspondence in mock mode. Set DATABASE_URL to enable writes.",
    );
  },

  async send(_userId: string, _id: string): Promise<Correspondence> {
    throw new Error("Cannot send correspondence in mock mode. Set DATABASE_URL to enable writes.");
  },
};

// Owner service (for compatibility)
export const ownerService = {
  async getAll(_userId: string): Promise<Owner[]> {
    return [...MOCK_OWNERS] as unknown as Owner[];
  },
};

// Lease service (for compatibility)
export const leaseService = {
  async getAll(_userId: string): Promise<Lease[]> {
    return [...MOCK_LEASES] as unknown as Lease[];
  },
};

// Expense service (for compatibility)
export const expenseService = {
  async getAll(_userId: string): Promise<Expense[]> {
    return [...MOCK_EXPENSES] as unknown as Expense[];
  },
};

// Contact service
export const contactService = {
  async getAll(_userId: string, _type?: string): Promise<MaintenanceContact[]> {
    let contacts = [...MOCK_CONTACTS];
    if (_type) {
      contacts = contacts.filter((c) => c.type === _type);
    }
    return contacts;
  },

  async getById(_userId: string, _id: string): Promise<MaintenanceContact | null> {
    const contact = MOCK_CONTACTS.find((c) => c.id === _id);
    return contact || null;
  },

  async create(_userId: string, _data: Partial<MaintenanceContact>): Promise<MaintenanceContact> {
    throw new Error("Cannot create contacts in mock mode. Set DATABASE_URL to enable writes.");
  },

  async update(
    _userId: string,
    _id: string,
    _data: Partial<MaintenanceContact>,
  ): Promise<MaintenanceContact> {
    throw new Error("Cannot update contacts in mock mode. Set DATABASE_URL to enable writes.");
  },

  async delete(_userId: string, _id: string): Promise<void> {
    throw new Error("Cannot delete contacts in mock mode. Set DATABASE_URL to enable writes.");
  },
};
