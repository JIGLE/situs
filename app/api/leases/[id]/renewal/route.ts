import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { createErrorResponse, readJson, ValidationError } from "@/lib/utils/error-handling";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** The JSON body, or the 400 for one that is not JSON: this route has no `withErrorHandler`. */
async function readBody<T>(request: NextRequest): Promise<T | Response> {
  try {
    return (await readJson(request)) as T;
  } catch (error) {
    if (error instanceof ValidationError) return createErrorResponse(error, 400, request);
    throw error;
  }
}

const leaseInclude = {
  property: { select: { name: true, address: true } },
  tenant: { select: { name: true, email: true } },
};

// POST — landlord sends a renewal offer
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await context.params;
  const prisma = getPrismaClient();

  const lease = await prisma.lease.findFirst({ where: { id, userId } });
  if (!lease) {
    return NextResponse.json({ error: "Lease not found" }, { status: 404 });
  }
  if (lease.status !== "active") {
    return NextResponse.json({ error: "Only active leases can be renewed" }, { status: 400 });
  }

  const body = await readBody<{
    proposedRent?: number;
    startDate?: string;
    endDate?: string;
    notes?: string;
  }>(request);
  if (body instanceof Response) return body;

  // Default proposed terms to current lease terms
  const renewalStartDate = body.startDate
    ? new Date(body.startDate)
    : new Date(new Date(lease.endDate).getTime() + 24 * 60 * 60 * 1000);
  const renewalEndDate = body.endDate
    ? new Date(body.endDate)
    : new Date(
        renewalStartDate.getFullYear() + 1,
        renewalStartDate.getMonth(),
        renewalStartDate.getDate(),
      );

  const updated = await prisma.lease.update({
    where: { id },
    data: {
      renewalStatus: "offered",
      renewalOfferedAt: new Date(),
      renewalRespondedAt: null,
      renewalProposedRent: body.proposedRent ?? lease.monthlyRent,
      renewalStartDate,
      renewalEndDate,
      renewalNotes: body.notes ?? null,
    },
    include: leaseInclude,
  });

  return NextResponse.json(updated, { status: 200 });
}

// PATCH — tenant (or owner) responds to the offer
export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await context.params;
  const prisma = getPrismaClient();

  const lease = await prisma.lease.findFirst({ where: { id, userId } });
  if (!lease) {
    return NextResponse.json({ error: "Lease not found" }, { status: 404 });
  }
  if (lease.renewalStatus !== "offered") {
    return NextResponse.json({ error: "No active renewal offer on this lease" }, { status: 400 });
  }

  const body = await readBody<{ response: "accepted" | "declined" }>(request);
  if (body instanceof Response) return body;
  if (body.response !== "accepted" && body.response !== "declined") {
    return NextResponse.json(
      { error: "response must be 'accepted' or 'declined'" },
      { status: 400 },
    );
  }

  const updated = await prisma.lease.update({
    where: { id },
    data: {
      renewalStatus: body.response,
      renewalRespondedAt: new Date(),
    },
    include: leaseInclude,
  });

  return NextResponse.json(updated, { status: 200 });
}

// DELETE — owner withdraws/cancels the renewal offer
export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await context.params;
  const prisma = getPrismaClient();

  const lease = await prisma.lease.findFirst({ where: { id, userId } });
  if (!lease) {
    return NextResponse.json({ error: "Lease not found" }, { status: 404 });
  }

  const updated = await prisma.lease.update({
    where: { id },
    data: {
      renewalStatus: null,
      renewalOfferedAt: null,
      renewalRespondedAt: null,
      renewalProposedRent: null,
      renewalStartDate: null,
      renewalEndDate: null,
      renewalNotes: null,
    },
    include: leaseInclude,
  });

  return NextResponse.json(updated, { status: 200 });
}
