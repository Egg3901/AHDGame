import { z } from "zod";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import { ZOD_COUNTRY_ENUM } from "@/lib/constants/countries";
import { schemas } from "../validate";
import {
  CONTRACT_SHARE_MIN,
  CONTRACT_SHARE_MAX,
  CONTRACT_ROYALTY_RATE_MIN,
  CONTRACT_ROYALTY_RATE_MAX,
  CONTRACT_TERM_TURNS_MIN,
  CONTRACT_TERM_TURNS_MAX,
} from "@/lib/constants/prospecting";

/**
 * Zod schemas for the resource-prospecting + extraction-contract player routes.
 * Bounds mirror src/lib/constants/prospecting.ts so the wire contract and the
 * turn-phase math never drift.
 */

const resourceSchema = z.enum(EXTRACTABLE_RESOURCES);
const stateIdSchema = z.string().min(1).max(12);

/** POST /api/prospecting/corporation */
export const corpProspectSchema = z.object({
  corporationId: z.union([schemas.objectId, z.string().regex(/^\d+$/, "Invalid ID format")]),
  stateId: stateIdSchema,
  resource: resourceSchema,
});

/** POST /api/prospecting/government */
export const governmentProspectSchema = z.object({
  countryId: z.enum(ZOD_COUNTRY_ENUM),
  stateId: stateIdSchema,
  resource: resourceSchema,
  level: z.enum(["national", "state"]),
});

/** POST /api/contracts/extraction/offer */
export const issueContractOfferSchema = z.object({
  countryId: z.enum(ZOD_COUNTRY_ENUM),
  stateId: stateIdSchema,
  corporationId: schemas.objectId,
  resource: resourceSchema,
  share: z.number().min(CONTRACT_SHARE_MIN).max(CONTRACT_SHARE_MAX),
  royaltyRatePerTurn: z.number().min(CONTRACT_ROYALTY_RATE_MIN).max(CONTRACT_ROYALTY_RATE_MAX),
  termTurns: z.number().int().min(CONTRACT_TERM_TURNS_MIN).max(CONTRACT_TERM_TURNS_MAX),
  signingFeeAnchor: z.number().min(0).max(1_000_000_000_000),
});

/** PATCH /api/admin/config/extraction */
export const adminExtractionConfigSchema = z
  .object({
    prospectingEnabled: z.boolean().optional(),
    contractIssuanceEnabled: z.boolean().optional(),
  })
  .refine((v) => v.prospectingEnabled !== undefined || v.contractIssuanceEnabled !== undefined, {
    message: "Provide at least one of prospectingEnabled or contractIssuanceEnabled",
  });

export type CorpProspectInput = z.infer<typeof corpProspectSchema>;
export type GovernmentProspectInput = z.infer<typeof governmentProspectSchema>;
export type IssueContractOfferInput = z.infer<typeof issueContractOfferSchema>;
