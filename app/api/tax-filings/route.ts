import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";

const filingSchema = z.object({
  year: z.number().int().min(2020).max(2040),
  country: z.string().length(2),
  regime: z.string().min(1),
  propertyIds: z.array(z.string()),
  grossIncome: z.number().nonnegative(),
  allowableExpenses: z.number().nonnegative(),
  taxableIncome: z.number().nonnegative(),
  taxDue: z.number().nonnegative(),
  effectiveRate: z.number().min(0).max(1),
  withholdingPaid: z.number().nonnegative(),
  balanceDue: z.number(),
  // No default: this schema serves the update half of the upsert too, where a default would turn
  // every save that leaves `status` out into a revert to draft. The create half defaults below.
  status: z.enum(["draft", "final"]).optional(),
  notes: z.array(z.string()).optional(),
  payload: z.string(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult as NextResponse;
  const prisma = getPrismaClient();
  const filings = await prisma.taxFiling.findMany({
    where: { userId: authResult.userId },
    orderBy: [{ year: "desc" }, { country: "asc" }],
  });
  return NextResponse.json({ data: filings });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult as NextResponse;
  const body = await request.json();
  const parsed = filingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { propertyIds, notes, ...rest } = parsed.data;
  const prisma = getPrismaClient();
  const filing = await prisma.taxFiling.upsert({
    where: {
      userId_year_country_regime: {
        userId: authResult.userId,
        year: rest.year,
        country: rest.country,
        regime: rest.regime,
      },
    },
    create: {
      userId: authResult.userId,
      ...rest,
      status: rest.status ?? "draft",
      propertyIds: JSON.stringify(propertyIds),
      notes: notes ? JSON.stringify(notes) : null,
    },
    update: {
      ...rest,
      propertyIds: JSON.stringify(propertyIds),
      notes: notes ? JSON.stringify(notes) : null,
    },
  });
  return NextResponse.json({ data: filing });
}
