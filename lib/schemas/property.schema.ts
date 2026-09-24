import { z } from "zod";

/**
 * Shared Property Schema
 *
 * This schema is used across the application to ensure consistency:
 * - Frontend validation (forms)
 * - Backend API validation
 * - Database operations
 *
 * Centralizing the schema prevents validation mismatches and drift.
 */

/**
 * The property's fields with no defaults, so a partial update never fills one in: an edit that
 * leaves `addressVerified` out must keep it, not reset it to false. That is the trap #393 fixed
 * for leases.
 *
 * There is no `country`: every property is in Portugal, and the column's default says so.
 */
const propertyFields = z.object({
  name: z.string().min(1, "Property name is required").max(100, "Name too long"),
  address: z.string().min(1, "Address is required").max(200, "Address too long"),

  // Enhanced address fields
  streetAddress: z.string().max(200, "Street address too long").optional(),
  city: z.string().max(100, "City name too long").optional(),
  // Optional, and a blank input sends "" (the form starts with it), so the pattern's last,
  // empty alternative admits the empty string. `.optional()` alone admits only a missing value.
  zipCode: z
    .string()
    .regex(/^(?:[0-9]{4}-[0-9]{3}|)$/, "Invalid postal code format")
    .optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  addressVerified: z.boolean(),

  // Building grouping
  buildingId: z.string().optional(),
  buildingName: z.string().max(100, "Building name too long").optional(),

  // Property details
  type: z.enum(["apartment", "house", "condo", "townhouse", "commercial", "other"]),
  bedrooms: z.number().min(0).max(20),
  bathrooms: z.number().min(0).max(20),
  rent: z.number().min(0, "Rent must be positive"),
  status: z.enum(["occupied", "vacant", "maintenance"]),
  description: z.string().max(500, "Description too long").optional(),
  image: z.string().url("Invalid image URL").optional(),

  // Where Finanças places it: the matriz article, and the fração within it. Nullish, not just
  // optional: the edit dialog loads a property as the API returns it, with null for an empty
  // column, and an unknown key used to be stripped where a known one now has to validate.
  cadasterReference: z.string().max(50, "Matriz article too long").nullish(),
  fraction: z.string().max(20, "Fraction too long").nullish(),
});

export const propertySchema = propertyFields.extend({
  addressVerified: propertyFields.shape.addressVerified.default(false),
});

/** `PUT /api/properties/[id]`: every field optional, none defaulted. */
export const updatePropertySchema = propertyFields.partial();

export const createPropertySchema = propertySchema.omit({ status: true });

export type PropertyFormData = z.infer<typeof propertySchema>;
export type Property = z.infer<typeof propertySchema>;
export type CreateProperty = z.infer<typeof createPropertySchema>;
