import { getPrismaClient } from "./services/database";
import {
  PropertyType,
  PropertyStatus,
  PaymentStatus,
  ReceiptType,
  ReceiptStatus,
  MaintenanceStatus,
  MaintenancePriority,
  UnitStatus,
  DocumentType,
  LeaseStatus,
} from "@prisma/client";

export async function seedDemoData(userId: string): Promise<void> {
  const prisma = getPrismaClient();

  // 1. Clean existing records for the sandbox user
  //
  // This used to swallow every cleanup failure with a `console.warn`, to avoid crashing the API on
  // a developer DB missing a migration. It did not avoid the crash — it moved it. Against a
  // database whose `tenants` table lacked `portalAccessRevokedAt`, the tenant cleanup failed, was
  // swallowed, and the run died three steps later on `Unique constraint failed on Owner.email`,
  // because the owners it was about to recreate had never been deleted. Half an hour went into
  // "the seeder is not idempotent" before the actual message turned out to be in a log nobody was
  // reading.
  //
  // Tolerating the delete never helped anyway: if a table or column is missing, the `create` for
  // that same model further down fails too. The swallow only bought a worse error message.
  //
  // So nothing is skipped. Schema drift — P2021 (no such table), P2022 (no such column) — is
  // reported as what it is, with the remedy attached; everything else is rethrown untouched.
  const cleanup = async (action: () => Promise<unknown>, name: string) => {
    try {
      await action();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "P2021" || code === "P2022") {
        const detail = err instanceof Error ? err.message.trim() : String(err);
        throw new Error(
          `Demo seed cannot clear ${name}: this database is behind prisma/schema.prisma ` +
            `(${code}). Run \`npx prisma db push\` against the DATABASE_URL this process is ` +
            `using, then seed again.\n\n${detail}`,
          { cause: err },
        );
      }
      throw err;
    }
  };

  await cleanup(() => prisma.receipt.deleteMany({ where: { userId } }), "receipts");
  await cleanup(() => prisma.expense.deleteMany({ where: { userId } }), "expenses");
  await cleanup(
    () => prisma.maintenanceTicket.deleteMany({ where: { userId } }),
    "maintenanceTickets",
  );
  await cleanup(() => prisma.correspondence.deleteMany({ where: { userId } }), "correspondence");
  // Documents and the bank graph are created below but were never cleared, so re-seeding stacked
  // a fresh copy on top of the last one: measured across a single seed call, documents went
  // 54 → 60 and bank transactions 90 → 100 while every other table held steady. That made the
  // seeder non-idempotent and any count-based baseline (see `scripts/mobile-audit.mjs`) drift
  // upward on every run. Bank rows go child-first — transactions reference accounts reference
  // connections. Units and rent periods are absent by design: they cascade from property/lease.
  await cleanup(() => prisma.document.deleteMany({ where: { userId } }), "documents");
  await cleanup(() => prisma.bankTransaction.deleteMany({ where: { userId } }), "bankTransactions");
  await cleanup(() => prisma.bankAccount.deleteMany({ where: { userId } }), "bankAccounts");
  await cleanup(() => prisma.bankConnection.deleteMany({ where: { userId } }), "bankConnections");
  await cleanup(
    () => prisma.propertyOwner.deleteMany({ where: { property: { userId } } }),
    "propertyOwners",
  );
  await cleanup(() => prisma.tenant.deleteMany({ where: { userId } }), "tenants");
  await cleanup(() => prisma.property.deleteMany({ where: { userId } }), "properties");
  await cleanup(() => prisma.owner.deleteMany({ where: { userId } }), "owners");

  console.log(`[seeder] Cleared demo data for user: ${userId}`);

  // 2. Create Owners
  const owner = await prisma.owner.create({
    data: {
      userId,
      name: "Prime Realty Holdings LLC",
      email: "holdings@primerealty.com",
      phone: "+351 912 345 678",
      address: "Avenida da Liberdade 120, 1250-144 Lisbon",
      notes: "Primary corporate vehicle for Lisbon and Porto holdings.",
    },
  });

  // 3. Create Properties (buildings grouped by address)
  const propertiesData = [
    {
      name: "Apartment 3A",
      address: "Av. da Liberdade 120, Lisbon",
      country: "PT",
      propertyCountry: "PT",
      type: "apartment" as PropertyType,
      bedrooms: 2,
      bathrooms: 1,
      rent: 1500,
      status: "occupied" as PropertyStatus,
      description: "Charming 2-bed apartment with balcony views over Av. da Liberdade.",
    },
    {
      name: "Penthouse B",
      address: "Av. da Liberdade 120, Lisbon",
      country: "PT",
      propertyCountry: "PT",
      type: "apartment" as PropertyType,
      bedrooms: 3,
      bathrooms: 2,
      rent: 3200,
      status: "occupied" as PropertyStatus,
      description: "Luxury 3-bedroom penthouse with terrace and private pool access.",
    },
    {
      name: "Apt 1B",
      address: "Av. da Liberdade 120, Lisbon",
      country: "PT",
      propertyCountry: "PT",
      type: "apartment" as PropertyType,
      bedrooms: 1,
      bathrooms: 1,
      rent: 1100,
      status: "vacant" as PropertyStatus,
      description: "Cozy 1-bedroom flat, newly renovated kitchen.",
    },
    {
      name: "Ground Floor Retail",
      address: "Rua de Santa Catarina 45, Porto",
      country: "PT",
      propertyCountry: "PT",
      type: "other" as PropertyType,
      bedrooms: 0,
      bathrooms: 1,
      rent: 2200,
      status: "occupied" as PropertyStatus,
      description: "Prime retail storefront in high foot-traffic district.",
    },
    {
      name: "Studio 201",
      address: "Rua de Santa Catarina 45, Porto",
      country: "PT",
      propertyCountry: "PT",
      type: "apartment" as PropertyType,
      bedrooms: 1,
      bathrooms: 1,
      rent: 850,
      status: "maintenance" as PropertyStatus,
      description: "Studio unit under scheduled floor restoration.",
    },
    {
      name: "Suite 404",
      address: "Calle de Alcalá 14, Madrid",
      country: "ES",
      propertyCountry: "ES",
      type: "condo" as PropertyType,
      bedrooms: 2,
      bathrooms: 2,
      rent: 1800,
      status: "occupied" as PropertyStatus,
      description: "Modern condo near Puerta del Sol.",
    },
  ];

  const dbProperties = [];
  for (const p of propertiesData) {
    const prop = await prisma.property.create({
      data: {
        userId,
        ...p,
      },
    });
    dbProperties.push(prop);

    // Link ownership
    await prisma.propertyOwner.create({
      data: {
        propertyId: prop.id,
        ownerId: owner.id,
        ownershipPercentage: 100.0,
      },
    });
  }

  // 4. Create Tenants
  const tenantsData = [
    {
      name: "João Silva",
      email: "joao.silva@outlook.pt",
      phone: "+351 933 222 111",
      rent: 1500,
      leaseStart: "2025-01-01",
      leaseEnd: "2026-12-31", // 24 months
      paymentStatus: "paid" as PaymentStatus,
      notes: "Portuguese national, prompt payer. Preferred communication: Email.",
      propertyIndex: 0, // Apartment 3A
    },
    {
      name: "Sophia Dubois",
      email: "s.dubois@gmail.com",
      phone: "+33 6 1234 5678",
      rent: 3200,
      leaseStart: "2025-06-01",
      leaseEnd: "2028-05-31", // 36 months
      paymentStatus: "paid" as PaymentStatus,
      notes: "Expats from France. Clean credit history.",
      propertyIndex: 1, // Penthouse B
    },
    {
      name: "Carlos Gómez",
      email: "carlos.g@gomez-retail.es",
      phone: "+34 600 112 233",
      rent: 2200,
      leaseStart: "2024-01-01",
      leaseEnd: "2029-12-31", // 72 months -> Long commercial/long-term lease
      paymentStatus: "paid" as PaymentStatus,
      notes: "Boutique clothing store tenant. Highly stable income stream.",
      propertyIndex: 3, // Ground Floor Retail
    },
    {
      name: "Ana Martínez",
      email: "ana.martinez@gmail.com",
      phone: "+34 677 889 900",
      rent: 1800,
      leaseStart: "2025-03-01",
      leaseEnd: "2026-02-28", // 12 months -> Short lease
      paymentStatus: "overdue" as PaymentStatus,
      notes: "Rent is late by 5 days for May 2026. Friendly rent reminders queued.",
      propertyIndex: 5, // Suite 404
    },
  ];

  const dbTenants = [];
  for (const t of tenantsData) {
    const prop = dbProperties[t.propertyIndex];

    const tenant = await prisma.tenant.create({
      data: {
        userId,
        name: t.name,
        email: t.email,
        phone: t.phone,
        rent: t.rent,
        leaseStart: new Date(t.leaseStart),
        leaseEnd: new Date(t.leaseEnd),
        paymentStatus: t.paymentStatus,
        notes: t.notes,
        propertyId: prop.id,
      },
    });
    dbTenants.push(tenant);
  }

  // 4b. Create Leases (one per tenant, mirroring their embedded lease dates/rent so the
  // Leases pillar and its `?detail=lease:id` overlay have genuine rows to audit/display)
  const now = new Date();
  for (let i = 0; i < tenantsData.length; i++) {
    const t = tenantsData[i];
    const tenant = dbTenants[i];
    const prop = dbProperties[t.propertyIndex];
    const endDate = new Date(t.leaseEnd);

    await prisma.lease.create({
      data: {
        userId,
        propertyId: prop.id,
        tenantId: tenant.id,
        startDate: new Date(t.leaseStart),
        endDate,
        monthlyRent: t.rent,
        deposit: t.rent,
        taxRegime: prop.country === "ES" ? "spain_inmuebles" : "portugal_rendimentos",
        status: endDate < now ? LeaseStatus.expired : LeaseStatus.active,
      },
    });
  }

  // 5. Create Receipts (Income)
  const receiptsData = [
    // João Silva (Jan - May 2026)
    {
      tenantIndex: 0,
      propertyIndex: 0,
      date: "2026-01-05",
      amount: 1500,
      type: "rent" as ReceiptType,
    },
    {
      tenantIndex: 0,
      propertyIndex: 0,
      date: "2026-02-05",
      amount: 1500,
      type: "rent" as ReceiptType,
    },
    {
      tenantIndex: 0,
      propertyIndex: 0,
      date: "2026-03-05",
      amount: 1500,
      type: "rent" as ReceiptType,
    },
    {
      tenantIndex: 0,
      propertyIndex: 0,
      date: "2026-04-05",
      amount: 1500,
      type: "rent" as ReceiptType,
    },
    {
      tenantIndex: 0,
      propertyIndex: 0,
      date: "2026-05-05",
      amount: 1500,
      type: "rent" as ReceiptType,
    },

    // Sophia Dubois (Jan - May 2026)
    {
      tenantIndex: 1,
      propertyIndex: 1,
      date: "2026-01-01",
      amount: 3200,
      type: "rent" as ReceiptType,
    },
    {
      tenantIndex: 1,
      propertyIndex: 1,
      date: "2026-02-01",
      amount: 3200,
      type: "rent" as ReceiptType,
    },
    {
      tenantIndex: 1,
      propertyIndex: 1,
      date: "2026-03-01",
      amount: 3200,
      type: "rent" as ReceiptType,
    },
    {
      tenantIndex: 1,
      propertyIndex: 1,
      date: "2026-04-01",
      amount: 3200,
      type: "rent" as ReceiptType,
    },
    {
      tenantIndex: 1,
      propertyIndex: 1,
      date: "2026-05-01",
      amount: 3200,
      type: "rent" as ReceiptType,
    },

    // Carlos Gómez (Jan - May 2026)
    {
      tenantIndex: 2,
      propertyIndex: 3,
      date: "2026-01-02",
      amount: 2200,
      type: "rent" as ReceiptType,
    },
    {
      tenantIndex: 2,
      propertyIndex: 3,
      date: "2026-02-02",
      amount: 2200,
      type: "rent" as ReceiptType,
    },
    {
      tenantIndex: 2,
      propertyIndex: 3,
      date: "2026-03-02",
      amount: 2200,
      type: "rent" as ReceiptType,
    },
    {
      tenantIndex: 2,
      propertyIndex: 3,
      date: "2026-04-02",
      amount: 2200,
      type: "rent" as ReceiptType,
    },
    {
      tenantIndex: 2,
      propertyIndex: 3,
      date: "2026-05-02",
      amount: 2200,
      type: "rent" as ReceiptType,
    },
  ];

  for (const r of receiptsData) {
    const tenant = dbTenants[r.tenantIndex];
    const prop = dbProperties[r.propertyIndex];

    await prisma.receipt.create({
      data: {
        userId,
        tenantId: tenant.id,
        propertyId: prop.id,
        amount: r.amount,
        date: new Date(r.date),
        type: r.type,
        status: "paid" as ReceiptStatus,
      },
    });
  }

  // 6. Create Expenses (Outflows)
  const expensesData = [
    {
      propertyIndex: 0,
      category: "Repairs",
      amount: 450,
      date: "2026-02-12",
      description: "Plumbing repair in Apartment 3A bathroom.",
    },
    {
      propertyIndex: 1,
      category: "Insurance",
      amount: 980,
      date: "2026-01-15",
      description: "Annual landlord building insurance package.",
    },
    {
      propertyIndex: 3,
      category: "Maintenance",
      amount: 350,
      date: "2026-03-10",
      description: "Air conditioning cleaning & filter swaps.",
    },
    {
      propertyIndex: 5,
      category: "Taxes",
      amount: 1200,
      date: "2026-04-01",
      description: "Madrid Local Property IBI Tax Payment.",
    },
    {
      propertyIndex: 0,
      category: "Mortgage Interest",
      amount: 800,
      date: "2026-05-01",
      description: "Monthly loan interest installment (Non-deductible category PT).",
    },
  ];

  for (const e of expensesData) {
    const prop = dbProperties[e.propertyIndex];

    await prisma.expense.create({
      data: {
        userId,
        propertyId: prop.id,
        amount: e.amount,
        date: new Date(e.date),
        category: e.category,
        description: e.description,
      },
    });
  }

  // 7. Create Maintenance Tickets
  const maintenanceData = [
    {
      propertyIndex: 0,
      tenantIndex: 0,
      title: "AC leak in master bedroom",
      description:
        "Water dripping from the wall split AC unit during operation. Needs HVAC inspection.",
      status: "in_progress" as MaintenanceStatus,
      priority: "high" as MaintenancePriority,
    },
    {
      propertyIndex: 5,
      tenantIndex: 3,
      title: "Loose front door handle",
      description:
        "Front door lock cylinder and handle are slightly loose. Hard to lock from inside.",
      status: "open" as MaintenanceStatus,
      priority: "medium" as MaintenancePriority,
    },
    {
      propertyIndex: 2,
      tenantIndex: null,
      title: "Scheduled painting prep",
      description:
        "Standard cosmetic wall prep and white painting layer for Apt 1B before renting.",
      status: "resolved" as MaintenanceStatus,
      priority: "low" as MaintenancePriority,
    },
  ];

  for (const m of maintenanceData) {
    const prop = dbProperties[m.propertyIndex];
    const tenant = m.tenantIndex !== null ? dbTenants[m.tenantIndex] : null;

    await prisma.maintenanceTicket.create({
      data: {
        userId,
        propertyId: prop.id,
        tenantId: tenant ? tenant.id : null,
        title: m.title,
        description: m.description,
        status: m.status,
        priority: m.priority,
        images: "[]",
      },
    });
  }

  // 8. Create Units
  const unitsData = [
    // Apartment 3A has 1 unit
    {
      propertyIndex: 0,
      number: "3A",
      floor: 3,
      sizeSqM: 85,
      bedrooms: 2,
      bathrooms: 1,
      status: "occupied" as UnitStatus,
    },
    // Penthouse B has 1 unit
    {
      propertyIndex: 1,
      number: "PH",
      floor: 10,
      sizeSqM: 180,
      bedrooms: 3,
      bathrooms: 2,
      status: "occupied" as UnitStatus,
    },
    // Apt 1B has 1 unit
    {
      propertyIndex: 2,
      number: "1B",
      floor: 1,
      sizeSqM: 55,
      bedrooms: 1,
      bathrooms: 1,
      status: "vacant" as UnitStatus,
    },
    // Ground Floor Retail has 1 unit
    {
      propertyIndex: 3,
      number: "G",
      floor: 0,
      sizeSqM: 120,
      bedrooms: 0,
      bathrooms: 1,
      status: "occupied" as UnitStatus,
    },
    // Studio 201 has 1 unit
    {
      propertyIndex: 4,
      number: "201",
      floor: 2,
      sizeSqM: 40,
      bedrooms: 1,
      bathrooms: 1,
      status: "maintenance" as UnitStatus,
    },
    // Suite 404 has 1 unit
    {
      propertyIndex: 5,
      number: "404",
      floor: 4,
      sizeSqM: 110,
      bedrooms: 2,
      bathrooms: 2,
      status: "occupied" as UnitStatus,
    },
  ];

  const dbUnits = [];
  for (const u of unitsData) {
    const prop = dbProperties[u.propertyIndex];
    const unit = await prisma.unit.create({
      data: {
        propertyId: prop.id,
        number: u.number,
        floor: u.floor,
        sizeSqM: u.sizeSqM,
        bedrooms: u.bedrooms,
        bathrooms: u.bathrooms,
        status: u.status,
      },
    });
    dbUnits.push(unit);
  }

  // 9. Create RentPeriods (for Jan-May 2026, all paid; June 2026 due/overdue)
  for (const tenant of dbTenants) {
    // Find the lease for this tenant
    const lease = await prisma.lease.findFirst({
      where: { tenantId: tenant.id },
    });

    if (lease && tenant.propertyId) {
      // Create periods for Jan-May 2026 (paid), June 2026 (due/overdue)
      for (let month = 1; month <= 6; month++) {
        const dueDate = new Date(2026, month - 1, 1); // 1st of each month
        const status = month <= 5 ? "paid" : "due";
        const paidAt = month <= 5 ? new Date(2026, month - 1, 5) : undefined; // Paid on 5th

        await prisma.rentPeriod.create({
          data: {
            userId,
            leaseId: lease.id,
            tenantId: tenant.id,
            propertyId: tenant.propertyId,
            year: 2026,
            month,
            dueDate,
            dueAmount: tenant.rent,
            allocatedAmount: month <= 5 ? tenant.rent : 0,
            paidAt,
            status,
          },
        });
      }
    }
  }

  // 10. Create BankConnection and BankAccount
  const bankConnection = await prisma.bankConnection.create({
    data: {
      userId,
      provider: "manual",
      institutionName: "Millennium BCP",
      status: "active",
      lastSyncAt: new Date(),
    },
  });

  const bankAccount = await prisma.bankAccount.create({
    data: {
      connectionId: bankConnection.id,
      userId,
      label: "Millennium BCP - Property Management",
      iban: "PT50003506519278167650195", // PT IBAN format (encrypted in production)
      ibanHash: "mock-hash-iban-001",
      ibanLast4: "0195",
      currency: "EUR",
      isActive: true,
    },
  });

  // 11. Create BankTransactions (movements matching the receipts)
  const bankTransactionsData = [
    // João Silva rent payments
    { amount: 1500, date: "2026-01-05", counterparty: "João Silva", ref: "JAN2026-APT3A" },
    { amount: 1500, date: "2026-02-05", counterparty: "João Silva", ref: "FEB2026-APT3A" },
    { amount: 1500, date: "2026-03-05", counterparty: "João Silva", ref: "MAR2026-APT3A" },
    { amount: 1500, date: "2026-04-05", counterparty: "João Silva", ref: "APR2026-APT3A" },
    { amount: 1500, date: "2026-05-05", counterparty: "João Silva", ref: "MAY2026-APT3A" },
    // Sophia Dubois rent payments
    { amount: 3200, date: "2026-01-01", counterparty: "Sophia Dubois", ref: "JAN2026-PENTHOUSE" },
    { amount: 3200, date: "2026-02-01", counterparty: "Sophia Dubois", ref: "FEB2026-PENTHOUSE" },
    { amount: 3200, date: "2026-03-01", counterparty: "Sophia Dubois", ref: "MAR2026-PENTHOUSE" },
    // Carlos Gómez rent payments
    { amount: 2200, date: "2026-01-15", counterparty: "Carlos Gómez", ref: "JAN2026-RETAIL" },
    { amount: 2200, date: "2026-02-15", counterparty: "Carlos Gómez", ref: "FEB2026-RETAIL" },
  ];

  let txId = 0;
  for (const tx of bankTransactionsData) {
    txId++;
    const fingerprint = `fp-${bankAccount.id}-${tx.date}-${tx.amount}-${txId}`;

    await prisma.bankTransaction.create({
      data: {
        userId,
        bankAccountId: bankAccount.id,
        fingerprint,
        amount: tx.amount,
        currency: "EUR",
        bookingDate: new Date(tx.date),
        valueDate: new Date(tx.date),
        counterpartyName: tx.counterparty,
        counterpartyIban: null,
        reference: tx.ref,
      },
    });
  }

  // 12. Create Documents (for OCR queue and document vault)
  const documentsData = [
    {
      name: "Lease_Agreement_3A_2025.pdf",
      propertyIndex: 0,
      tenantIndex: 0,
      type: "contract" as DocumentType,
    },
    {
      name: "Rental_Receipt_Jan2026.pdf",
      propertyIndex: 0,
      tenantIndex: 0,
      type: "receipt" as DocumentType,
    },
    {
      name: "Property_Certificate_PT.pdf",
      propertyIndex: 1,
      tenantIndex: null,
      type: "certificate" as DocumentType,
    },
    {
      name: "Floor_Plan_Suite404.pdf",
      propertyIndex: 5,
      tenantIndex: 3,
      type: "floor_plan" as DocumentType,
    },
    {
      name: "Invoice_HVAC_Maintenance.pdf",
      propertyIndex: 0,
      tenantIndex: null,
      type: "invoice" as DocumentType,
    },
    {
      name: "Property_Photo_Exterior.jpg",
      propertyIndex: 1,
      tenantIndex: null,
      type: "photo" as DocumentType,
    },
  ];

  for (const doc of documentsData) {
    const prop = dbProperties[doc.propertyIndex];
    const tenant = doc.tenantIndex !== null ? dbTenants[doc.tenantIndex] : null;

    await prisma.document.create({
      data: {
        userId,
        name: doc.name,
        description: `Document for property ${prop.name}`,
        type: doc.type,
        mimeType: doc.name.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
        storagePath: `/documents/${prop.id}/${doc.name}`,
        fileSize: Math.floor(Math.random() * 5000000) + 100000, // 100KB - 5MB
        propertyId: prop.id,
        ...(tenant && { tenantId: tenant.id }),
      },
    });
  }

  console.log(`[seeder] Successfully seeded mock data workspace for demo-user: ${userId}`);
}
