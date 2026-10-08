import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { deleteOwnAccount } from "@/lib/services/auth/accounts";
import { withErrorHandler } from "@/lib/utils/error-handling";

/**
 * POST /api/user/delete-data — the signed-in account deletes itself and everything it owns (GDPR
 * erasure). The only administrator cannot while other accounts remain: a 409 `last_admin`, since the
 * instance would be left with accounts and nobody to administer them.
 *
 * No audit entry is written first. It would belong to the account and go with it in the same cascade,
 * so it would record nothing, and a refusal would leave one that says a deletion happened.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { session, userId } = authResult;

  await deleteOwnAccount(userId);

  // Note: the audit log of this user is deleted with it, by cascade. For compliance you may want to
  // keep anonymized deletion records separately.
  console.info(`[GDPR] User data deleted: ${session.user.email} at ${new Date().toISOString()}`);

  return Response.json({ message: "Data deleted successfully" });
}

export const POST = withErrorHandler(handlePost);
