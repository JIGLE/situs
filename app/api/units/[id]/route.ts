import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { createErrorResponse, parseBody, ValidationError } from "@/lib/utils/error-handling";
import { updateUnitSchema } from "@/lib/schemas/unit.schema";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { userId } = authResult;
    const { id } = await params;
    const prisma = getPrismaClient();

    const unit = await prisma.unit.findFirst({
      where: {
        id,
        property: {
          userId,
        },
      },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
        leases: {
          include: {
            tenant: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        documents: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!unit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    return NextResponse.json(unit);
  } catch (error) {
    console.error("Error fetching unit:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { userId } = authResult;
    const { id } = await params;
    const data = parseBody(await request.json(), updateUnitSchema);

    const prisma = getPrismaClient();

    // Verify unit ownership
    const existingUnit = await prisma.unit.findFirst({
      where: {
        id,
        property: {
          userId,
        },
      },
    });

    if (!existingUnit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    // Only what was sent. This used to set floor, size, bedrooms and bathrooms to null whenever
    // they were left out, and stored a 0 in any of them as null too.
    const unit = await prisma.unit.update({
      where: { id },
      data,
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
      },
    });

    return NextResponse.json(unit);
  } catch (error: unknown) {
    if (error instanceof ValidationError) return createErrorResponse(error, 400, request);
    console.error("Error updating unit:", error);

    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json(
        { error: "A unit with this number already exists for this property" },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { userId } = authResult;
    const { id } = await params;
    const prisma = getPrismaClient();

    // Verify unit ownership
    const unit = await prisma.unit.findFirst({
      where: {
        id,
        property: {
          userId,
        },
      },
    });

    if (!unit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    // Delete unit
    await prisma.unit.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting unit:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
