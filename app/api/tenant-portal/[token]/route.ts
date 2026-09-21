/**
 * Tenant Portal API
 * GET /api/tenant-portal/[token] - Get tenant portal data
 */

import { NextRequest, NextResponse } from "next/server";
import { getPrismaClient } from "@/lib/services/database/database";
import {
  ResourceNotFoundError,
  ValidationError,
  createErrorResponse,
  createSuccessResponse,
} from "@/lib/utils/error-handling";
import { verifyPortalToken } from "@/lib/services/auth/tenant-portal-auth";

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<Response | NextResponse> {
  try {
    const { token } = await params;

    if (!token) {
      return createErrorResponse(new ValidationError("Token is required"), 400, request);
    }

    // Verify token
    const tokenData = await verifyPortalToken(token);
    if (!tokenData) {
      return createErrorResponse(new Error("Invalid or expired token"), 401, request);
    }

    const prisma = getPrismaClient();

    // Fetch tenant data
    const tenant = await prisma.tenant.findUnique({
      where: { id: tokenData.tenantId },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true,
            currency: true,
          },
        },
      },
    });

    if (!tenant) {
      return createErrorResponse(new ResourceNotFoundError("Tenant"), 404, request);
    }

    // Fetch invoices for this tenant
    const invoices = await prisma.invoice.findMany({
      where: { tenantId: tenant.id },
      orderBy: { dueDate: "desc" },
      take: 20,
    });

    // Fetch recent payments
    const payments = await prisma.paymentTransaction.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        invoice: {
          select: { number: true },
        },
        paymentMethod: {
          select: { type: true },
        },
      },
    });

    return createSuccessResponse({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        email: tenant.email,
        phone: tenant.phone,
        leaseStart: tenant.leaseStart.toISOString(),
        leaseEnd: tenant.leaseEnd.toISOString(),
        rent: tenant.rent,
        paymentStatus: tenant.paymentStatus,
        property: tenant.property
          ? {
              id: tenant.property.id,
              name: tenant.property.name,
              address: tenant.property.address,
            }
          : undefined,
      },
      invoices: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        amount: inv.amount,
        dueDate: inv.dueDate.toISOString(),
        status: inv.status,
        paidDate: inv.paidDate?.toISOString(),
      })),
      recentPayments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        date: p.createdAt.toISOString(),
        method: p.paymentMethod?.type || "unknown",
        status: p.status,
        invoiceNumber: p.invoice?.number,
      })),
    });
  } catch (error) {
    console.error("Tenant portal error:", error);
    return createErrorResponse(
      error instanceof Error ? error : new Error("Failed to load portal data"),
      500,
      request,
    );
  }
}
