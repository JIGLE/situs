import { PropertyType } from "@prisma/client";
import { getPrismaClient } from "../database";
import { assertOwnsRelations } from "../assert-owned";
import { assertPropertyHasNoHistory } from "../history";
import { Property } from "@/lib/types";

export const propertyService = {
  async getAll(userId: string): Promise<Property[]> {
    const properties = await getPrismaClient().property.findMany({
      where: { userId },
      include: { tenants: true, receipts: true },
    });
    return properties.map((p) => ({
      ...p,
      streetAddress: p.streetAddress || undefined,
      city: p.city || undefined,
      zipCode: p.zipCode || undefined,
      country: p.country || undefined,
      latitude: p.latitude || undefined,
      longitude: p.longitude || undefined,
      addressVerified: p.addressVerified || false,
      buildingId: p.buildingId || undefined,
      buildingName: p.buildingName || undefined,
      description: p.description || undefined,
      image: p.image || undefined,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
  },

  async getById(userId: string, id: string): Promise<Property | null> {
    const property = await getPrismaClient().property.findUnique({
      where: { id, userId },
      include: { tenants: true, receipts: true },
    });
    if (!property) return null;
    return {
      ...property,
      streetAddress: property.streetAddress || undefined,
      city: property.city || undefined,
      zipCode: property.zipCode || undefined,
      country: property.country || undefined,
      latitude: property.latitude || undefined,
      longitude: property.longitude || undefined,
      addressVerified: property.addressVerified || false,
      buildingId: property.buildingId || undefined,
      buildingName: property.buildingName || undefined,
      description: property.description || undefined,
      image: property.image || undefined,
      createdAt: property.createdAt.toISOString(),
      updatedAt: property.updatedAt.toISOString(),
    };
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
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        rent: data.rent,
        status: data.status,
        description: data.description,
        image: data.image,
        cadasterReference: data.cadasterReference,
        fraction: data.fraction,
      },
    });
    try {
      console.debug("[database] created property:", property);
    } catch {}
    return {
      ...property,
      streetAddress: property.streetAddress || undefined,
      city: property.city || undefined,
      zipCode: property.zipCode || undefined,
      country: property.country || undefined,
      latitude: property.latitude || undefined,
      longitude: property.longitude || undefined,
      addressVerified: property.addressVerified || false,
      buildingId: property.buildingId || undefined,
      buildingName: property.buildingName || undefined,
      description: property.description || undefined,
      image: property.image || undefined,
      createdAt: property.createdAt.toISOString(),
      updatedAt: property.updatedAt.toISOString(),
    };
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
    });
    return {
      ...property,
      streetAddress: property.streetAddress || undefined,
      city: property.city || undefined,
      zipCode: property.zipCode || undefined,
      country: property.country || undefined,
      latitude: property.latitude || undefined,
      longitude: property.longitude || undefined,
      addressVerified: property.addressVerified || false,
      buildingId: property.buildingId || undefined,
      buildingName: property.buildingName || undefined,
      description: property.description || undefined,
      image: property.image || undefined,
      createdAt: property.createdAt.toISOString(),
      updatedAt: property.updatedAt.toISOString(),
    };
  },

  /** Refused while the property has history (`lib/services/database/history.ts`). */
  async delete(userId: string, id: string): Promise<void> {
    await assertPropertyHasNoHistory(userId, id);
    await getPrismaClient().property.delete({ where: { id, userId } });
  },
};
