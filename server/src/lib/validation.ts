import { z } from "zod";

export const projectFields = z.object({
  name: z.string().trim().min(3, "Project name must have at least 3 characters").max(80),
  description: z.string().trim().max(280).optional(),
}).strict();

export const projectUpdate = projectFields.partial().extend({
  status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "Provide a field to change" });
