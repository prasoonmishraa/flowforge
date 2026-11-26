import { z } from "zod";

export const createWorkflowStepSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Step name is required")
    .max(150, "Step name must be 150 characters or fewer"),

  step_type: z
    .string()
    .trim()
    .min(1, "Step type is required")
    .max(100, "Step type must be 100 characters or fewer"),

  config: z.record(z.string(), z.unknown()).default({}),

  position: z
    .number()
    .int("Step position must be an integer")
    .positive("Step position must be a positive integer"),
});
export const updateWorkflowStepSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Step name cannot be empty")
      .max(150, "Step name must be 150 characters or fewer")
      .optional(),

    step_type: z
      .string()
      .trim()
      .min(1, "Step type cannot be empty")
      .max(100, "Step type must be 100 characters or fewer")
      .optional(),

    config: z.record(z.string(), z.unknown()).optional(),

    position: z
      .number()
      .int("Step position must be an integer")
      .positive("Step position must be a positive integer")
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });
