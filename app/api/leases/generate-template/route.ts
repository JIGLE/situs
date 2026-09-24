import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { z } from "zod";
import { documentExport } from "@/lib/services/pdf-generator";

const generateLeaseSchema = z.object({
  landlordName: z.string().min(1),
  landlordNif: z.string().min(1),
  landlordAddress: z.string().min(1),
  landlordEmail: z.string().email().optional(),
  landlordPhone: z.string().optional(),
  tenantName: z.string().min(1),
  tenantNif: z.string().min(1),
  tenantAddress: z.string().min(1),
  tenantEmail: z.string().email().optional(),
  tenantPhone: z.string().optional(),
  propertyAddress: z.string().min(1),
  propertyDescription: z.string().optional(),
  propertyTypology: z.string().optional(),
  cadasterReference: z.string().optional(),
  licencaHabitacao: z.string().optional(),
  energyCertificateClass: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  monthlyRent: z.number().positive(),
  deposit: z.number().min(0),
  paymentDueDay: z.number().min(1).max(31).optional(),
  autoRenew: z.boolean(),
  renewalNoticeDays: z.number().optional(),
  isRendaAcessivel: z.boolean().optional(),
  includedUtilities: z.array(z.string()).optional(),
  specialClauses: z.array(z.string()).optional(),
  signatureDate: z.string().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult as NextResponse;

    const body = await request.json();
    const parsed = generateLeaseSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await documentExport.generateLeasePDF(parsed.data);

    if (!result.buffer) {
      return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
    }

    const pdfBody = new Uint8Array(result.buffer);

    return new NextResponse(pdfBody, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.fileName}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Error generating lease template:", error);
    return NextResponse.json({ error: "Failed to generate lease document" }, { status: 500 });
  }
}
