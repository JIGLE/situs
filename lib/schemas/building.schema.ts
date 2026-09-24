import { z } from "zod";

export const buildingSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  address: z.string().max(200, "Address too long").optional(),
  city: z.string().max(100, "City too long").optional(),
  country: z.string().max(10, "Country too long").optional(),
});

export const createBuildingSchema = buildingSchema;

export type BuildingFormData = z.infer<typeof buildingSchema>;
export type CreateBuilding = z.infer<typeof createBuildingSchema>;
