import { z } from "zod";
import { schemas } from "../validate";

export const sendFundsSchema = z.object({
  characterId: schemas.objectId,
  amount: z.coerce.number().int().min(1000, "Minimum transfer is $1,000"),
});

export type SendFundsBody = z.infer<typeof sendFundsSchema>;
