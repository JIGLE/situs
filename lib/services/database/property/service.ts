import { type Prisma, PropertyType } from "@prisma/client";
import { getPrismaClient } from "../database";
import { assertOwnsRelations } from "../assert-owned";
import { assertPropertyHasNoHistory } from "../history";
import { Property } from "@/lib/types";
import { derivePropertyStatuses } from "../derived-state";

type PropertyRow = Prisma.PropertyGetPayload<{ include: { building: { select: { name: true } } } }>;

/** Read with every property, so the building's name comes from the building itself. */
const INCLUDE = { building: { select: { name: true } } } as const;

/**
 * A property as the app reads it. Occupied or vacant comes from its leases, the building's name
 * from its building (`../derived-state.ts`); the stored copies are not read.
 */
function toProperty(row: PropertyRow, status: Property["status"] | undefined): Property {
  const { building, ...p } = row;
  return {
    ...p,
    status: status ?? (p.status as Property["status"]),
    streetAddress: p.streetAddress || undefined,
    city: p.city || undefined,
    zipCode: p.zipCode || undefined,
    country: p.country || undefined,
    latitude: p.latitude || undefined,
    longitude: p.longitude || undefined,
    addressVerified: p.addressVerified || false,
    buildingId: p.buildingId || undefined,
    buildingName: building?.name || p.buildingName || undefined,
    description: p.description || undefined,
    image: p.image || undefined,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function withDerived(userId: string, row: PropertyRow): Promise<Property> {
  const statuses = await derivePropertyStatuses(userId, [row]);
  return toProperty(row, statuses.get(row.id));
}

export const propertyService = {
  /** Every property, or one page of them, newest first, when `page` is given. */
  async getAll(userId: string, page?: { skip: number; take: number }): Promise<Property[]> {
    const properties = await getPrismaClient().property.findMany({
      where: { userId },
      include: INCLUDE,
      ...(page
        ? { skip: page.skip, take: page.take, orderBy: { createdAt: "desc" as const } }
        : {}),
    });
    const statuses = await derivePropertyStatuses(userId, properties);
    return properties.map((p) => toProperty(p, statuses.get(p.id)));
  },

  async getById(userId: string, id: string): Promise<Property | null> {
    const property = await getPrismaClient().property.findUnique({
      where: { id, userId },
      include: INCLUDE,
    });
    if (!property) return null;
    return withDerived(userId, property);
  },

  async create(
    userId: string,
    data: Omit<Property, "id" | "userId" | "createdAt" | "updatedAt">,
  ): Promise<Property> {
    // A property can be filed under a building; the id comes from the request.
    await assertOwnsRelations(userId, { buildingId: data.buildingId });

    const property = await getPrismaClient().property.create({
      data: {
        userId,
        name: data.name,
        address: data.address,
        streetAddress: data.streetAddress,
        city: data.city,
        zipCode: data.zipCode,
        latitude: data.latitude,
        longitude: data.longitude,
        addressVerified: data.addressVerified,
        buildingId: data.buildingId,
        buildingName: data.buildingName,
        type: data.type as PropertyType,
        // Unknown is NULL: Finanças does not say how many rooms a property has.
        bedrooms: data.bedrooms ?? null,
        bathrooms: data.bathrooms ?? null,
        rent: data.rent,
        status: data.status,
        description: data.description,
        image: data.image,
        cadasterReference: data.cadasterReference,
        fraction: data.fraction,
      },
      include: INCLUDE,
    });
    try {
      console.debug("[database] created property:", property);
    } catch {}
    return withDerived(userId, property);
  },

  async update(
    userId: string,
    id: string,
    data: Partial<Omit<Property, "id" | "userId" | "createdAt" | "updatedAt">>,
  ): Promise<Property> {
    await assertOwnsRelations(userId, { buildingId: data.buildingId });

    const property = await getPrismaClient().property.update({
      where: { id, userId },
      data: {
        name: data.name,
        address: data.address,
        streetAddress: data.streetAddress,
        city: data.city,
        zipCode: data.zipCode,
        latitude: data.latitude,
        longitude: data.longitude,
        addressVerified: data.addressVerified,
        buildingId: data.buildingId,
        buildingName: data.buildingName,
        type: data.type as PropertyType,
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        rent: data.rent,
        status: data.status,
        description: data.description,
        image: data.image,
        cadasterReference: data.cadasterReference,
        fraction: data.fraction,
      },
      include: INCLUDE,
    });
    return withDerived(userId, property);
  },

  /** Refused while the property has history (`lib/services/database/history.ts`). */
  async delete(userId: string, id: string): Promise<void> {
    await assertPropertyHasNoHistory(userId, id);
    await getPrismaClient().property.delete({ where: { id, userId } });
  },
};
