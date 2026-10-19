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