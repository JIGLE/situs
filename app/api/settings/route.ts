import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { isMockMode } from "@/lib/config/data-mode";
import { createErrorResponse, parseBody, ValidationError } from "@/lib/utils/error-handling";
import { updateSettingsSchema } from "@/lib/schemas/settings.schema";

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { userId } = authResult;

    // In mock mode, return default settings
    if (isMockMode) {
      return NextResponse.json({
        data: {
          userId,
          theme: "system",
          language: "en",
          defaultCurrency: "USD",
          defaultTaxCountry: "US",
          emailNotifications: true,
          taxReminderNotifications: true,
          distributionNotifications: true,
          onboardingDismissedAt: null,
        },
      });
    }

    const prisma = getPrismaClient();
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
    });

    return NextResponse.json({ data: settings });
  } catch (error) {
    console.error("Failed to get settings:", error);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { userId } = authResult;

    // Checked before the upsert: a wrong type used to reach Prisma and answer 500.
    const data = parseBody(await request.json(), updateSettingsSchema);

    // In mock mode, just echo back the settings
    if (isMockMode) {
      return NextResponse.json({
        data: {
          userId,
          theme: data.theme || "system",
          language: data.language || "en",
          defaultCurrency: data.defaultCurrency || "USD",
          defaultTaxCountry: data.defaultTaxCountry || "US",
          emailNotifications: data.emailNotifications ?? true,
          taxReminderNotifications: data.taxReminderNotifications ?? true,
          distributionNotifications: data.distributionNotifications ?? true,
          onboardingDismissedAt: data.onboardingDismissedAt ?? null,
        },
      });
    }

    const prisma = getPrismaClient();
    const settings = await prisma.userSettings.upsert({
      where: { userId },
      update: {
        theme: data.theme,
        language: data.language,
        defaultCurrency: data.defaultCurrency,
        defaultTaxCountry: data.defaultTaxCountry,
        emailNotifications: data.emailNotifications,
        taxReminderNotifications: data.taxReminderNotifications,
        distributionNotifications: data.distributionNotifications,
        onboardingDismissedAt: data.onboardingDismissedAt,
      },
      create: {
        userId,
        theme: data.theme,
        language: data.language,
        defaultCurrency: data.defaultCurrency,
        defaultTaxCountry: data.defaultTaxCountry,
        emailNotifications: data.emailNotifications,
        taxReminderNotifications: data.taxReminderNotifications,
        distributionNotifications: data.distributionNotifications,
        onboardingDismissedAt: data.onboardingDismissedAt,
      },
    });

    return NextResponse.json({ data: settings });
  } catch (error) {
    if (error instanceof ValidationError) return createErrorResponse(error, 400, request);
    console.error("Failed to save settings:", error);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
