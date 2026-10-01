import { ConflictError } from "@/lib/utils/error-handling";

/**
 * A tenant's or an owner's email is unique per account (`@@unique([userId, email])`).
 *
 * It used to be unique across every account, so a second tenant with an address already on file
 * answered "Internal server error", and a landlord could learn, from the refusal, that someone
 * else's tenant had it. Now it is only refused within the account, in words, and a record with no
 * email is stored as NULL (`blankToNull`, `lib/schemas/tax-identity.ts`), which a unique index admits
 * any number of.
 *
 * Neither model has another unique index a caller can reach, so Prisma's P2002 on a write to one of
 * them is this one.
 */
export class EmailInUseError extends ConflictError {
  constructor(entity: "tenant" | "owner") {
    super(`Another ${entity} of this account already has that email address`, "email_in_use");
    this.name = "EmailInUseError";
  }
}

/** Runs a tenant's or an owner's write, and turns the one error a duplicate email raises into a 409. */
export async function refuseDuplicateEmail<T>(
  entity: "tenant" | "owner",
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "P2002") throw new EmailInUseError(entity);
    throw error;
  }
}
