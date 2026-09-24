import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getAnnualTaxSummary } from "@/lib/services/income-distribution";

// GET /api/distributions/tax-summary - One owner's income for the year, as they declare it for IRS
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { userId } = authResult;

    const { searchParams } = new URL(request.url);
    const ownerId = searchParams.get("ownerId");
    const year = searchParams.get("year");

    if (!ownerId) {
      return NextResponse.json({ error: "ownerId is required" }, { status: 400 });
    }

    // `ownerId` is attacker-controlled. Scoping is inside getAnnualTaxSummary, so an owner
    // belonging to someone else now yields a zeroed summary rather than their income and
    // per-property breakdown.
    const taxYear = year ? parseInt(year) : new Date().getFullYear() - 1;
    const summary = await getAnnualTaxSummary(ownerId, userId, taxYear);

    return NextResponse.json({ data: summary });
  } catch (error) {
    console.error("Failed to get tax summary:", error);
    return NextResponse.json({ error: "Failed to load tax summary" }, { status: 500 });
  }
}
