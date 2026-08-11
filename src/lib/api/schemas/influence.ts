import { z } from "zod";
import { schemas } from "@/lib/api/validate";

export const characterInfluenceActionSchema = z.object({
  action: z.enum(["raise", "lower", "barnstorm"]),
});

export type CharacterInfluenceActionBody = z.infer<typeof characterInfluenceActionSchema>;

const influenceContextSchema = z
  .object({
    electionId: z.string().optional(),
    candidateId: z.string().optional(),
    targetStateId: z.string().optional(),
  })
  .optional();

export const partyInfluenceSchema = z.object({
  nppId: schemas.nppObjectId,
  influenceType: z.enum([
    "boost_favorability",
    "boost_influence",
    "boost_loyalty",
    "reduce_stubbornness",
    "relocate_state",
    "endorse_candidate",
    "withdraw_election",
    "oppose_candidate",
    "support_leadership",
  ]),
  fundAmount: z.number().min(0).optional().default(0),
  context: influenceContextSchema.default({}),
});

/** Batch queue of party influence actions — max 20 items per request */
export const partyInfluenceQueueSchema = z.object({
  queue: z
    .array(
      z.object({
        nppId: schemas.nppObjectId,
        influenceType: z.enum([
          "boost_favorability",
          "boost_influence",
          "boost_loyalty",
          "reduce_stubbornness",
          "relocate_state",
          "endorse_candidate",
          "withdraw_election",
          "oppose_candidate",
          "support_leadership",
        ]),
        fundAmount: z.number().min(0).optional().default(0),
        context: influenceContextSchema.default({}),
      })
    )
    .min(1)
    .max(20),
});

export const nppInfluenceSchema = z.object({
  influenceType: z.enum([
    "boost_favorability",
    "boost_influence",
    "boost_loyalty",
    "reduce_stubbornness",
    "relocate_state",
    "endorse_candidate",
    "withdraw_election",
    "oppose_candidate",
    "support_leadership",
  ]),
  fundAmount: z.number().min(0).optional().default(0),
  context: influenceContextSchema.default({}),
});
