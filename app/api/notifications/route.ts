import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { isMockMode } from "@/lib/config/data-mode";
import { isDemoRequest } from "@/lib/demo/demo-mode";
import { z } from "zod";

const createNotificationSchema = z.object({
  type: z.enum([
    "lease_expiring",
    "payment_due",
    "payment_received",
    "payment_overdue",
    "maintenance_created",
    "maintenance_completed",
    "document_uploaded",
    "rent_receipt_due",
    "nrua_registration",
    "lease_renewal_reminder",
    "inbound_message",
    "system",
    "other",
  ]),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  entityType: z.string().max(50).optional(),
  entityId: z.string().max(100).optional(),
  payload: z.string().optional(), // JSON string
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    if (isDemoRequest(request)) {
      return NextResponse.json({
        notifications: [],
        total: 0,
        unreadCount: 0,
      });
    }

    if (isMockMode) {
      return NextResponse.json([]);
    }

    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult as NextResponse;
    const { userId } = authResult;

    const prisma = getPrismaClient();
    const { searchParams } = new URL(request.url);

    const unreadOnly = searchParams.get("unread") === "true";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const where: Record<string, unknown> = { userId };
    if (unreadOnly) {
      where.read = false;
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.notification.count({ where }),
    ]);

    return NextResponse.json({
      notifications,
      total,
      unreadCount: unreadOnly
        ? total
        : await prisma.notification.count({ where: { userId, read: false } }),
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (isDemoRequest(request)) {
      const body = await request.json();
      const parsed = createNotificationSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten() },
          { status: 400 },
        );
      }

      const now = new Date().toISOString();
      return NextResponse.json(
        {
          id: `demo-notification-${Date.now()}`,
          userId: "demo-user",
          read: false,
          createdAt: now,
          updatedAt: now,
          ...parsed.data,
        },
        { status: 201 },
      );
    }

    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult as NextResponse;
    const { userId } = authResult;

    const body = await request.json();
    const parsed = createNotificationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const prisma = getPrismaClient();
    const notification = await prisma.notification.create({
      data: {
        userId,
        ...parsed.data,
      },
    });

    return NextResponse.json(notification, { status: 201 });
  } catch (error) {
    console.error("Error creating notification:", error);
    return NextResponse.json({ error: "Failed to create notification" }, { status: 500 });
  }
}
