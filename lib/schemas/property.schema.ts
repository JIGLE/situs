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

export const propertySchema = z.object({
  name: z.string().min(1, "Property name is required").max(100, "Name too long"),
  address: z.string().min(1, "Address is required").max(200, "Address too long"),

  // Enhanced address fields
  streetAddress: z.string().max(200, "Street address too long").optional(),
  city: z.string().max(100, "City name too long").optional(),
  zipCode: z
    .string()
    .regex(/^(?:[0-9]{4}-[0-9]{3}|[0-9]{5})$/, "Invalid postal code format")
    .optional(),
  country: z.enum(["PT", "ES"]).default("PT"),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  addressVerified: z.boolean().default(false),

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
});

export const createPropertySchema = propertySchema.omit({ status: true });

export type PropertyFormData = z.infer<typeof propertySchema>;
export type Property = z.infer<typeof propertySchema>;
export type CreateProperty = z.infer<typeof createPropertySchema>;
