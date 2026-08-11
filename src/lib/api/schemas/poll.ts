import { z } from "zod";

export const pollCommissionSchema = z.object({
  type: z.enum(["small", "large"]).optional().default("small"),
});
