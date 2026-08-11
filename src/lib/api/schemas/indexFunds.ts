import { z } from "zod";
import { ZOD_CURRENCY_ENUM } from "@/lib/constants/currencies";

export const subscribeIndexFundSchema = z.object({
  units: z.number().int().min(1),
  /** Optional: which currency wallet to debit from (defaults to auto-convert from home). */
  payCurrency: z.enum(ZOD_CURRENCY_ENUM).optional(),
});
