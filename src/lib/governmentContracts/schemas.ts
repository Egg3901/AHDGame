import { z } from "zod";
import { BIDDING_TURNS_MIN, BIDDING_TURNS_MAX } from "./rules";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import {
  CONTRACT_TERM_TURNS_MIN,
  CONTRACT_TERM_TURNS_MAX,
  GOVT_CONTRACT_MAX_TOTAL_SHARE,
  CONTRACT_ROYALTY_RATE_MAX,
} from "@/lib/constants/prospecting";
const amount = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const terms = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("defence"),
      component: z.enum(["ground", "naval", "air", "rocket", "space", "marine"]),
      lots: z.number().int().positive().max(1000000),
      grade: z.number().int().min(0).max(3),
      maximumPricePerLot: amount.positive().int(),
    })
    .strict(),
  z
    .object({
      type: z.literal("extraction"),
      stateId: z.string().min(1).max(40),
      resource: z.enum(EXTRACTABLE_RESOURCES),
      share: z.number().min(0.01).max(GOVT_CONTRACT_MAX_TOTAL_SHARE),
      termTurns: z.number().int().min(CONTRACT_TERM_TURNS_MIN).max(CONTRACT_TERM_TURNS_MAX),
      royaltyRatePerTurn: z.number().min(0).max(CONTRACT_ROYALTY_RATE_MAX),
      minimumSigningFeeAnchor: amount,
    })
    .strict(),
]);
export const publishTenderSchema = z
  .object({
    title: z.string().trim().min(5).max(120),
    description: z.string().trim().min(10).max(2000),
    biddingTurns: z.number().int().min(BIDDING_TURNS_MIN).max(BIDDING_TURNS_MAX).optional(),
    closesTurn: z.number().int().optional(),
    awardDeadlineTurn: z.number().int().optional(),
    terms,
  })
  .strict()
  .superRefine((input, ctx) => {
    const explicit = input.closesTurn != null || input.awardDeadlineTurn != null;
    if (
      (explicit && input.biddingTurns != null) ||
      (explicit && (input.closesTurn == null || input.awardDeadlineTurn == null))
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose a bidding duration or a complete pair of deadlines, not both.",
      });
  });
export const bidSchema = z
  .object({
    corporationId: z.string().regex(/^[a-f0-9]{24}$/),
    sectorId: z
      .string()
      .regex(/^[a-f0-9]{24}$/)
      .optional(),
    amount,
    withdraw: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export const awardSchema = z
  .object({
    corporationId: z.string().regex(/^[a-f0-9]{24}$/),
    reason: z.string().trim().min(10).max(1000),
    acknowledgeConflict: z.boolean().optional(),
  })
  .strict();
export const cancelSchema = z.object({ reason: z.string().trim().min(10).max(1000) }).strict();
