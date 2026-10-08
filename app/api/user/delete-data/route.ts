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
 *
 * The answer says how many bank consents the bank would not end (`bankConsentsNotRevoked`), for the
 * holder to end at their bank; the account's stored files and email log rows are removed with it.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { bankConsentsNotRevoked } = await deleteOwnAccount(userId);

  // The account's own audit entries went with it, by cascade; for compliance you may want to keep
  // anonymised deletion records separately. The log names the id, not the address that was erased.
  console.info(`[GDPR] User data deleted: ${userId} at ${new Date().toISOString()}`);

  return Response.json({ message: "Data deleted successfully", bankConsentsNotRevoked });
}

export const POST = withErrorHandler(handlePost);
