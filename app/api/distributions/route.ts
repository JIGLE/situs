import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { createErrorResponse, ResourceNotFoundError } from "@/lib/utils/error-handling";
import {
  calculateDistribution,
  saveDistribution,
  getDistributionHistory,
  DistributionInput,
} from "@/lib/services/income-distribution";

// GET /api/distributions - Get distribution history
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { userId } = authResult;

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const year = searchParams.get("year");

    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    // `propertyId` is attacker-controlled — it comes straight off the query string, and
    // `requireAuth` only proves a session exists, never whose. The scoping is inside
    // getDistributionHistory so it cannot be skipped; a property belonging to someone else
    // now returns an empty history rather than their income and per-owner shares.
    const distributions = await getDistributionHistory(
      propertyId,
      userId,
      year ? parseInt(year) : undefined,
    );

    return NextResponse.json({ data: distributions });
  } catch (error) {
    console.error("Failed to get distributions:", error);
    return NextResponse.json({ error: "Failed to load distributions" }, { status: 500 });
  }
}

// POST /api/distributions - Calculate and save a new distribution
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { userId } = authResult;

    const data = await request.json();

    // Validate required fields
    if (!data.propertyId || !data.periodStart || !data.periodEnd) {
      return NextResponse.json(
        { error: "propertyId, periodStart, and periodEnd are required" },
        { status: 400 },
      );
    }

    if (!data.owners || data.owners.length === 0) {
      return NextResponse.json({ error: "At least one owner is required" }, { status: 400 });
    }

    const input: DistributionInput = {
      propertyId: data.propertyId,
      periodStart: new Date(data.periodStart),
      periodEnd: new Date(data.periodEnd),
      totalIncome: parseFloat(data.totalIncome) || 0,
      totalExpenses: parseFloat(data.totalExpenses) || 0,
      owners: data.owners.map((o: { ownerId: string; ownerName: string; percentage: number }) => ({
        ownerId: o.ownerId,
        ownerName: o.ownerName,
        percentage: parseFloat(String(o.percentage)),
      })),
      calculatedByUserId: userId,
    };

    // Calculate the distribution
    const result = calculateDistribution(input);

    // Save if requested. saveDistribution verifies that the property and every ownerId in the
    // body belong to this user before writing anything — `calculatedByUserId` above records
    // who asked, which is audit metadata, not authorization.
    if (data.save !== false) {
      const saved = await saveDistribution(result, userId);
      return NextResponse.json({ data: saved }, { status: 201 });
    }

    // Return preview without saving
    return NextResponse.json({ data: result, preview: true });
  } catch (error) {
    // createErrorResponse resolves the status from the error TYPE, so the ownership failures
    // thrown by saveDistribution surface as 404 rather than being flattened into a 500 with
    // the message "Property not found" — which is both the wrong status and, in a 500 body,
    // an unhelpful leak of internal phrasing.
    if (error instanceof ResourceNotFoundError) {
      return createErrorResponse(error, 404, request);
    }
    console.error("Failed to calculate distribution:", error);
    // The message stays static. Anything reaching here is unexpected, and an unexpected error's
    // text is written for a developer — Prisma phrasing, file paths, column names. The log above
    // keeps it; the response does not.
    return NextResponse.json({ error: "Failed to calculate distribution" }, { status: 500 });
  }
}
