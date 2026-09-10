import { z } from "zod";
import { AD_MAX_ACTIONS } from "./rules";

export const quoteCountSchema = z.coerce.number().int().min(1).max(AD_MAX_ACTIONS);

export const targetKey = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const purchaseSchema = z
  .object({
    stateId: targetKey,
    dimension: targetKey,
    bucket: targetKey,
    count: z.number().int().min(1).max(AD_MAX_ACTIONS),
    quote: z.object({
      turn: z.number().int().nonnegative(),
      cost: z.number().finite().nonnegative(),
      revision: z.number().int().nonnegative(),
    }),
  })
  .strict();
