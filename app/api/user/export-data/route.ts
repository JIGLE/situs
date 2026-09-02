import { NextRequest } from "next/server";
import { ApiError } from "@/lib/utils/errors";
import { getPrismaClient } from "@/lib/services/database/database";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { logAudit, getAuditLogsForUser } from "@/lib/services/audit-log";
import {
  buildExportInclude,
  excludedRelations,
  EXPORT_DENY_LIST,
} from "@/lib/services/gdpr/export-scope";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;
    const { session } = authResult;
    const prisma = getPrismaClient();

    // Every relation on User except the deny-listed credential tables, read from the schema
    // rather than a hand-kept list — see lib/services/gdpr/export-scope.ts for why.
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: buildExportInclude(),
    });

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    // Get audit logs for GDPR export
    const auditLogs = await getAuditLogsForUser(session.user.id);

    // Log this export action for GDPR compliance
    await logAudit({
      userId: session.user.id,
      action: "EXPORT_PERSONAL_DATA",
      details: { exportedAt: new Date().toISOString() },
    });

    // `auditLogs` is fetched separately because getAuditLogsForUser applies the same shaping
    // the audit UI uses; the include above would return the raw rows.
    const exportData = {
      ...user,
      auditLogs,
      exportedAt: new Date().toISOString(),
      // Article 15(1) asks the controller to say what is held, so an export that silently
      // omits something is worse than one that names the omission. These are credentials, not
      // personal data, and handing them over in a downloadable file would be a security bug.
      excludedFromExport: excludedRelations().map((relation) => ({
        relation,
        reason: EXPORT_DENY_LIST[relation],
      })),
    };

    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=user-data.json",
      },
    });
  } catch (error) {
    console.error("Data export error:", error);
    return Response.json({ error: "Export failed" }, { status: 500 });
  }
}
