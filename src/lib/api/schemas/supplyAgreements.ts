import { z } from "zod";
import {
  SUPPLY_AGREEMENT_DURATION_MAX_TURNS,
  SUPPLY_AGREEMENT_DURATION_MIN_TURNS,
} from "@/lib/db/types/supplyAgreement";
import { schemas } from "@/lib/api/validate";

const durationTurns = z
  .number()
  .int()
  .min(SUPPLY_AGREEMENT_DURATION_MIN_TURNS)
  .max(SUPPLY_AGREEMENT_DURATION_MAX_TURNS)
  .optional();

const terms = {
  volumeCap: z.number().finite().positive(),
  pricePremium: z.number().finite(),
  exclusive: z.boolean().optional().default(false),
  durationTurns,
};

/** POST /api/corporations/[id]/supply-agreements. */
export const supplyAgreementProposalSchema = z
  .object({
    /** Set when the route corporation is the buyer. */
    supplierCorpId: schemas.objectId.optional(),
    /** Set when the route corporation is the supplier. */
    buyerCorpId: schemas.objectId.optional(),
    commodity: z.string().min(1),
    stateId: z.string().trim().min(1).max(32).optional(),
    ...terms,
  })
  .refine((body) => (body.supplierCorpId ? !body.buyerCorpId : !!body.buyerCorpId), {
    message: "Provide exactly one of supplierCorpId or buyerCorpId",
    path: ["counterparty"],
  });

/** PATCH /api/corporations/[id]/supply-agreements/[agreementId]. */
export const supplyAgreementUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("counter"),
    ...terms,
  }),
]);

export type SupplyAgreementProposalInput = z.infer<typeof supplyAgreementProposalSchema>;
export type SupplyAgreementUpdateInput = z.infer<typeof supplyAgreementUpdateSchema>;
