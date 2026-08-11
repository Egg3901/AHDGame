import { z } from "zod";

export const recruitNPPSchema = z.object({
  stateId: z.string().min(2).max(10),
});
