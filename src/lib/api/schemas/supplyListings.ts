import { z } from "zod";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import {
  SUPPLY_AGREEMENT_PRICE_BAND,
  SUPPLY_AGREEMENT_DURATION_MIN_TURNS,
  SUPPLY_AGREEMENT_DURATION_MAX_TURNS,
} from "@/lib/db/types/supplyAgreement";
import { supplyAgreementRequiresState } from "@/lib/market/commodityMarketScope";
const slot = z.number().int().min(0).max(9);
export const supplyListingQuerySchema = z.object({
  commodity: z.enum(COMMODITY_TYPES).optional(),
  page: z.coerce.number().int().min(0).max(100).default(0),
});
export const supplyListingActionSchema = z
  .discriminatedUnion("action", [
    z.object({ action: z.literal("withdraw"), slot }),
    z.object({
      action: z.literal("publish"),
      slot,
      side: z.enum(["buy", "sell"]),
      commodity: z.enum(COMMODITY_TYPES),
      stateId: z.string().trim().min(1).max(32).optional(),
      volumeCap: z.number().finite().positive(),
      pricePremium: z.number().min(-SUPPLY_AGREEMENT_PRICE_BAND).max(SUPPLY_AGREEMENT_PRICE_BAND),
      durationTurns: z
        .number()
        .int()
        .min(SUPPLY_AGREEMENT_DURATION_MIN_TURNS)
        .max(SUPPLY_AGREEMENT_DURATION_MAX_TURNS)
        .optional(),
      validForTurns: z.number().int().min(1).max(336).default(168),
    }),
  ])
  .refine(
    (body) =>
      body.action === "withdraw" || !supplyAgreementRequiresState(body.commodity) || !!body.stateId,
    { message: "This commodity requires a fulfillment state", path: ["stateId"] }
  );
