import { z } from "zod";

/** Mirrors the `UnitStatus` enum in prisma/schema.prisma; `unit.schema.test.ts` holds them equal. */
export const UNIT_STATUSES = ["vacant", "occupied", "maintenance", "reserved"] as const;

/**
 * A unit's own fields, with no defaults, so a partial update never fills one in: a PUT that leaves
 * `status` out must leave it alone, not reset it. That is the trap #393 fixed for leases.
 *
 * 0 is a value here, not a blank: a ground floor, a T0's bedrooms. `null` clears a field.
 */
const unitFields = z.object({
  number: z.string().trim().min(1, "Unit number is required").max(20, "Unit number too long"),
  floor: z.number().int().min(-10).max(200).nullable(),
  sizeSqM: z.number().positive().max(100000).nullable(),
  bedrooms: z.number().int().min(0).max(20).nullable(),
  bathrooms: z.number().int().min(0).max(20).nullable(),
  status: z.enum(UNIT_STATUSES),
  notes: z.string().max(2000).nullable(),
});

/** `POST /api/units`. A unit left without a status takes the column default, `vacant`. */
export const createUnitSchema = unitFields.partial().extend({
  propertyId: z.string().min(1, "Property ID is required"),
  number: unitFields.shape.number,
});

/** `PUT /api/units/[id]`. There is no `propertyId`: a unit never moves to another property. */
export const updateUnitSchema = unitFields.partial();
