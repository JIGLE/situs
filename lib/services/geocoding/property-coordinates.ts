import { getPrismaClient } from "@/lib/services/database/database";
import { alreadyFailed, locate, type GeocodeDeps, type LocationPrecision } from "./nominatim";

/** How many properties one request places: Nominatim's one a second keeps a request short. */
export const GEOCODE_BATCH = 4;

export interface PlacedProperty {
  id: string;
  latitude: number;
  longitude: number;
  precision: LocationPrecision;
}

export interface GeocodeBatchResult {
  placed: PlacedProperty[];
  /** Properties still without coordinates that a further request would try. */
  remaining: number;
}

/**
 * Places up to `GEOCODE_BATCH` of the owner's properties that have an address and no
 * coordinates, writing what Nominatim found onto each. Only the coordinates are written: the
 * address the owner typed or imported stays as it is, and `addressVerified` stays false, since a
 * pin found from an address is not the owner picking one.
 *
 * The map asks again while `remaining` is above zero and the last batch placed something.
 */
export async function placeMissingProperties(
  userId: string,
  deps: GeocodeDeps = {},
): Promise<GeocodeBatchResult> {
  const prisma = getPrismaClient();
  const missing = await prisma.property.findMany({
    where: { userId, OR: [{ latitude: null }, { longitude: null }] },
    select: { id: true, address: true, streetAddress: true, city: true, zipCode: true },
    orderBy: { createdAt: "asc" },
  });
  const candidates = missing.filter((p) => p.address.trim() && !alreadyFailed(p));
  const batch = candidates.slice(0, GEOCODE_BATCH);

  const placed: PlacedProperty[] = [];
  for (const property of batch) {
    const found = await locate(property, deps);
    if (!found) continue;
    // Scoped by owner as well as id, and only while still unplaced: an address the owner picked in
    // the form while this ran is not overwritten.
    const { count } = await prisma.property.updateMany({
      where: { id: property.id, userId, latitude: null },
      data: {
        latitude: found.latitude,
        longitude: found.longitude,
        locationPrecision: found.precision,
      },
    });
    if (count === 1) {
      placed.push({
        id: property.id,
        latitude: found.latitude,
        longitude: found.longitude,
        precision: found.precision,
      });
    }
  }

  const remaining = candidates.slice(batch.length).length;
  return { placed, remaining };
}
