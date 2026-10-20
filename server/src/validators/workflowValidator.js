import { z } from "zod";

export const createWorkflowSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workflow name is required")
    .max(150, "Workflow name must be 150 characters or fewer"),
  description: z
    .string()
    .optional(),
});

export const updateWorkflowSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Workflow name cannot be empty")
      .max(150, "Workflow name must be 150 characters or fewer")
      .optional(),
    description: z.string().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });