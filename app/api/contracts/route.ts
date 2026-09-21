import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { isMockMode } from "@/lib/config/data-mode";
import { leaseService } from "@/lib/services/database/database.mock";

// GET /api/contracts - List all leases (contracts)
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { userId } = authResult;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    // In mock mode, use mock lease service
    if (isMockMode) {
      const leases = await leaseService.getAll(userId);
      // Filter by status if provided
      const filteredLeases = status ? leases.filter((l) => l.status === status) : leases;
      // Transform to match frontend contract shape
      const contracts = filteredLeases.map((lease) => ({
        id: lease.id,
        propertyName: lease.property?.name || "Unknown Property",
        unitName: null,
        tenantName: lease.tenant?.name || "Unknown Tenant",
        startDate: lease.startDate,
        endDate: lease.endDate,
        monthlyRent: lease.monthlyRent,
        currency: "EUR",
        status: lease.status,
      }));
      return NextResponse.json({ data: contracts });
    }

    const whereClause: Record<string, unknown> = { userId };
    if (status) whereClause.status = status;

    const prisma = getPrismaClient();
    const leases = await prisma.lease.findMany({
      where: whereClause,
      include: {
        property: { select: { name: true } },
        tenant: { select: { name: true } },
        unit: { select: { number: true } },
      },
      orderBy: [{ endDate: "asc" }],
    });

    // Transform to frontend contract shape
    const contracts = leases.map((lease) => ({
      id: lease.id,
      propertyName: lease.property?.name || "Unknown Property",
      unitName: lease.unit?.number || null,
      tenantName: lease.tenant?.name || "Unknown Tenant",
      startDate:
        lease.startDate instanceof Date ? lease.startDate.toISOString() : String(lease.startDate),
      endDate:
        lease.endDate instanceof Date
          ? lease.endDate.toISOString()
          : lease.endDate
            ? String(lease.endDate)
            : null,
      monthlyRent: lease.monthlyRent,
      currency: "EUR",
      status: lease.status,
    }));

    return NextResponse.json({ data: contracts });
  } catch (error) {
    console.error("Failed to get contracts:", error);
    return NextResponse.json({ error: "Failed to load contracts" }, { status: 500 });
  }
}

// POST /api/contracts - Create a new lease (contract)
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { userId } = authResult;

    // In mock mode, reject write operations
    if (isMockMode) {
      return NextResponse.json(
        { error: "Write operations not supported in mock mode" },
        { status: 403 },
      );
    }

    const data = await request.json();

    const prisma = getPrismaClient();
    const lease = await prisma.lease.create({
      data: {
        userId,
        propertyId: data.propertyId,
        tenantId: data.tenantId,
        unitId: data.unitId || null,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        monthlyRent: Number(data.monthlyRent),
        deposit: Number(data.deposit) || 0,
        status: data.status || "active",
        notes: data.notes || null,
      },
      include: {
        property: { select: { name: true } },
        tenant: { select: { name: true } },
        unit: { select: { number: true } },
      },
    });

    const contract = {
      id: lease.id,
      propertyName: lease.property?.name || "Unknown Property",
      unitName: lease.unit?.number || null,
      tenantName: lease.tenant?.name || "Unknown Tenant",
      startDate: lease.startDate.toISOString(),
      endDate: lease.endDate?.toISOString() || null,
      monthlyRent: lease.monthlyRent,
      currency: "EUR",
      status: lease.status,
    };

    return NextResponse.json({ data: contract }, { status: 201 });
  } catch (error) {
    console.error("Failed to create contract:", error);
    return NextResponse.json({ error: "Failed to create contract" }, { status: 500 });
  }
}
