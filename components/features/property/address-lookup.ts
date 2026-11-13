import { apiFetch } from "@/lib/utils/api-client";
import type { AddressSuggestion } from "@/lib/utils/address-verification";
import type { Located, ReverseAddress } from "@/lib/services/geocoding/nominatim";

export type { ReverseAddress };

/** What asking the map about an address came to. */
export type LookupResult =
  | { state: "found"; found: Located }
  | { state: "notFound" }
  /** The map could not be asked: says nothing about the address. */
  | { state: "unreachable" };

interface AddressInput {
  address: string;
  streetAddress?: string | null;
  city?: string | null;
  zipCode?: string | null;
}

/** Where the server's geocoder places an address (`/api/properties/geocode/lookup`). */
export async function lookupAddress(
  csrfToken: string | null,
  input: AddressInput,
): Promise<LookupResult> {
  try {
    const { found } = await apiFetch<{ found: Located | null }>(
      "/api/properties/geocode/lookup",
      csrfToken,
      "POST",
      {
        address: input.address,
        streetAddress: input.streetAddress || null,
        city: input.city || null,
        zipCode: input.zipCode || null,
      },
    );
    return found ? { state: "found", found } : { state: "notFound" };
  } catch {
    return { state: "unreachable" };
  }
}

/** The address at a point, or null when there is none or the map is out of reach. */
export async function reverseLookup(
  csrfToken: string | null,
  point: { latitude: number; longitude: number },
): Promise<ReverseAddress | null> {
  try {
    const { address } = await apiFetch<{ address: ReverseAddress | null }>(
      "/api/properties/geocode/reverse",
      csrfToken,
      "POST",
      point,
    );
    return address;
  } catch {
    return null;
  }
}

/** One line, as a recibo writes it: "Rua de Angola 25, 1170-020 Lisboa". */
export function composeAddress(
  address: Pick<ReverseAddress, "streetAddress" | "zipCode" | "city">,
) {
  const place = [address.zipCode, address.city].filter(Boolean).join(" ");
  return [address.streetAddress, place].filter(Boolean).join(", ");
}

/** A suggestion with a door number is the door; one without, its street. */
export function suggestionPrecision(suggestion: AddressSuggestion): "exact" | "street" {
  return suggestion.address.house_number ? "exact" : "street";
}
