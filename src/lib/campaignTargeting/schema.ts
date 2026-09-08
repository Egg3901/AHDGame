import { z } from "zod";

export const targetKey = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const purchaseSchema = z.object({
  stateId: targetKey,
  dimension: targetKey,
  bucket: targetKey,
  turns: z.number().int().min(1).max(12).default(1),
  quote: z.object({
    turn: z.number().int().nonnegative(),
    cost: z.number().finite().nonnegative(),
    revision: z.number().int().nonnegative(),
  }),
});
