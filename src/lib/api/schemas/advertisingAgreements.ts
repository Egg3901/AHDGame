import { z } from "zod";
import {
  AD_AGREEMENT_BUDGET_BPS,
  AD_AGREEMENT_DURATION_MAX_TURNS,
  AD_AGREEMENT_DURATION_MIN_TURNS,
  AD_AGREEMENT_MIN_SHARE_BPS,
} from "@/lib/advertising/types";
import { schemas } from "@/lib/api/validate";

const allocationShareBps = z
  .number()
  .int()
  .min(AD_AGREEMENT_MIN_SHARE_BPS)
  .max(AD_AGREEMENT_BUDGET_BPS);

const durationTurns = z
  .number()
  .int()
  .min(AD_AGREEMENT_DURATION_MIN_TURNS)
  .max(AD_AGREEMENT_DURATION_MAX_TURNS)
  .optional();

/** POST /api/corporations/[id]/advertising-agreements. */
export const advertisingAgreementProposalSchema = z
  .object({
    /** Set when the route corporation is the buyer. */
    supplierCorpId: schemas.objectId.optional(),
    /** Set when the route corporation is the supplier. */
    buyerCorpId: schemas.objectId.optional(),
    allocationShareBps,
    durationTurns,
  })
  .refine((body) => (body.supplierCorpId ? !body.buyerCorpId : !!body.buyerCorpId), {
    message: "Provide exactly one of supplierCorpId or buyerCorpId",
    path: ["counterparty"],
  });

/** PATCH /api/corporations/[id]/advertising-agreements/[agreementId]. */
export const advertisingAgreementUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("counter"),
    allocationShareBps,
    durationTurns,
  }),
]);

export type AdvertisingAgreementProposalInput = z.infer<typeof advertisingAgreementProposalSchema>;
export type AdvertisingAgreementUpdateInput = z.infer<typeof advertisingAgreementUpdateSchema>;
