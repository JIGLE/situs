import { getPrismaClient } from "@/lib/services/database/database";
import { ResourceNotFoundError, ValidationError } from "@/lib/utils/error-handling";
import type { BuildingUnitsInput } from "@/lib/schemas/building-expense.schema";

/**
 * Sets which of the owner's properties are the building's units, all at once, with each unit's
 * permilagem: the building sheet's list of ticked properties. A property ticked here leaves any
 * other building it was in; one unticked leaves this building and its permilagem, which was this
 * building's. Expenses already split stay as they were split: a past cost does not move.
 */
export async function setBuildingUnits(
  userId: string,
  buildingId: string,
  input: BuildingUnitsInput,
): Promise<{ propertyIds: string[] }> {
  const prisma = getPrismaClient();
  const building = await prisma.building.findFirst({
    where: { id: buildingId, userId },
    select: { id: true },
  });
  if (!building) throw new ResourceNotFoundError("Building not found");

  const ids = [...new Set(input.units.map((u) => u.propertyId))];
  if (ids.length !== input.units.length) {
    throw new ValidationError("A unit is listed twice", "units");
  }
  const owned = await prisma.property.count({ where: { id: { in: ids }, userId } });
  if (owned !== ids.length) throw new ResourceNotFoundError("Property not found");

  await prisma.$transaction([
    prisma.property.updateMany({
      where: { userId, buildingId, id: { notIn: ids } },
      data: { buildingId: null, permilage: null },
    }),
    ...input.units.map((unit) =>
      prisma.property.updateMany({
        where: { id: unit.propertyId, userId },
        data: { buildingId, permilage: unit.permilage ?? null },
      }),
    ),
  ]);
  return { propertyIds: ids };
}
