import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import {
  createErrorResponse,
  RawBody,
  readJson,
  ValidationError,
} from "@/lib/utils/error-handling";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult as NextResponse;
    const { userId } = authResult;
    const { id } = await context.params;

    const prisma = getPrismaClient();
    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    return NextResponse.json(notification);
  } catch (error) {
    console.error("Error fetching notification:", error);
    return NextResponse.json({ error: "Failed to fetch notification" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult as NextResponse;
    const { userId } = authResult;
    const { id } = await context.params;

    const body = (await readJson(request)) as RawBody;

    const prisma = getPrismaClient();
    const existing = await prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    const notification = await prisma.notification.update({
      where: { id },
      data: {
        read: body.read ?? existing.read,
      },
    });

    return NextResponse.json(notification);
  } catch (error) {
    if (error instanceof ValidationError) return createErrorResponse(error, 400, request);
    console.error("Error updating notification:", error);
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult as NextResponse;
    const { userId } = authResult;
    const { id } = await context.params;

    const prisma = getPrismaClient();
    const existing = await prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    await prisma.notification.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting notification:", error);
    return NextResponse.json({ error: "Failed to delete notification" }, { status: 500 });
  }
}
