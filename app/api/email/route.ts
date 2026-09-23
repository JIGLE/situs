import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/error-handling";
import { emailService, EMAIL_TEMPLATES, EmailTemplate } from "@/lib/services/email/email-service";
import { z } from "zod";

const sendEmailSchema = z.object({
  templateId: z.string(),
  recipientEmail: z.string().email(),
  variables: z.object({}).passthrough(),
  customSubject: z.string().optional(),
});

const bulkEmailSchema = z.object({
  emails: z.array(
    z.object({
      email: z.string().email(),
      templateId: z.string(),
      variables: z.object({}).passthrough(),
    }),
  ),
  batchSize: z.number().min(1).max(50).default(10),
});

// GET /api/email - List the available email templates
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Require authentication to list templates
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;

    const templates = Object.values(EMAIL_TEMPLATES).map((template: EmailTemplate) => ({
      id: template.id,
      name: template.name,
      subject: template.subject,
      variables: template.variables,
    }));

    return createSuccessResponse(templates);
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

// POST /api/email - Send a single email
export async function POST(request: NextRequest): Promise<Response | NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  try {
    const body = await request.json();
    const validatedData = sendEmailSchema.parse(body);

    if (!emailService.isReady()) {
      return createErrorResponse(new Error("Email service not configured"), 503, request);
    }

    const result = await emailService.sendTemplatedEmail(
      validatedData.templateId,
      validatedData.recipientEmail,
      validatedData.variables,
      authResult.userId,
      validatedData.customSubject,
    );

    if (result.success) {
      return createSuccessResponse({
        message: "Email sent successfully",
        messageId: result.messageId,
      });
    } else {
      return createErrorResponse(new Error(result.error), 500, request);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse(new Error("Invalid request data"), 400, request);
    }
    return createErrorResponse(error as Error, 500, request);
  }
}

// PUT /api/email - Send bulk emails
export async function PUT(request: NextRequest): Promise<Response | NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  try {
    const body = await request.json();
    const validatedData = bulkEmailSchema.parse(body);

    if (!emailService.isReady()) {
      return createErrorResponse(new Error("Email service not configured"), 503, request);
    }

    const result = await emailService.sendBulkEmails(
      validatedData.emails,
      validatedData.batchSize,
      undefined, // delayMs
      authResult.userId,
    );

    return createSuccessResponse({
      message: `Bulk email operation completed`,
      success: result.success,
      failed: result.failed,
      errors: result.errors,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse(new Error("Invalid request data"), 400, request);
    }
    return createErrorResponse(error as Error, 500, request);
  }
}
