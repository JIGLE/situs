import { apiFetch } from "@/lib/utils/api-client";
import type { PlannedShare } from "@/lib/services/financas-import/landlords";
import type { Owner } from "@/lib/types";

/**
 * Sets a property's owners from a plan (`planShares`): an owner the plan names by id is assigned
 * as they are, anyone else is added as an owner first, then each gets their share through
 * `/api/property-owners`, which keeps the shares dated and refuses more than 100%.
 *
 * `added` maps a NIF (or, without a valid one, a name) to the owner created for it, so one import that names the same person on many
 * properties adds them once. Throws on the first failure, with the HTTP status `apiFetch` attaches.
 */
export async function applyShares(
  propertyId: string,
  shares: PlannedShare[],
  added: Map<string, string>,
): Promise<void> {
  for (const share of shares) {
    // A NIF that fails its check is not stored, so such a person is known by name instead.
    const key = share.taxId ?? `name:${share.name.trim().toLowerCase()}`;
    let ownerId = share.ownerId ?? added.get(key);
    if (!ownerId) {
      const owner = await apiFetch<{ id: string }>("/api/owners", {
        method: "POST",
        body: JSON.stringify({ name: share.name, taxIdentificationNumber: share.taxId }),
      });
      ownerId = owner.id;
      added.set(key, ownerId);
    }
    await apiFetch("/api/property-owners", {
      method: "POST",
      body: JSON.stringify({
        propertyId,
        ownerId,
        // Thirds and the like: four places keep the sum within the route's tolerance of 100.
        ownershipPercentage: Math.round(share.percentage * 10_000) / 10_000,
      }),
    });
  }
}

/** Whether the property already has owners in force, in which case an import leaves them. */
export function hasOwners(owners: Owner[] | undefined, propertyId: string): boolean {
  return (owners ?? []).some((owner) =>
    (owner.properties ?? []).some((share) => share.propertyId === propertyId),
  );
}
