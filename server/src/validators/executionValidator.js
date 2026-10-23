import { z } from "zod";

export const updateExecutionStatusSchema = z.object({
  status: z.enum(["running", "completed", "failed"]),
});
