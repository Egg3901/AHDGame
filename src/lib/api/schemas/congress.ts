import { z } from "zod";
import { containsBlockedName, containsSlur } from "@/lib/moderation";
import { ZOD_COUNTRY_ENUM } from "@/lib/constants/countries";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import { schemas } from "../validate";
import { BILL_CATEGORIES, MAX_PROVISIONS } from "@shared/constants/legislation";
import { VETO_MESSAGE_MIN_LENGTH, VETO_MESSAGE_MAX_LENGTH } from "@/lib/constants/governorOffice";

export const speakerActionSchema = z
  .object({
    action: z.enum([
      "declare",
      "withdraw",
      "vote",
      "start_election",
      "reset_election",
      "force_end",
      "file_vacate_motion",
      "vote_vacate_motion",
    ]),
    nominationId: z.string().optional(),
    /** Ballot on a motion to vacate: "for" = vacate the Speaker, "against" = keep. */
    vacateVote: z.enum(["for", "against"]).optional(),
  })
  .refine((data) => data.action !== "vote" || (data.nominationId && data.nominationId.length > 0), {
    message: "nominationId required when action is vote",
    path: ["nominationId"],
  })
  .refine((data) => data.action !== "vote_vacate_motion" || data.vacateVote !== undefined, {
    message: "vacateVote required when action is vote_vacate_motion",
    path: ["vacateVote"],
  });

export const houseLeadershipActionSchema = z
  .object({
    action: z.enum([
      "start_election",
      "reset_election",
      "force_end",
      "declare",
      "withdraw",
      "vote",
    ]),
    role: z.enum(["majority_leader", "minority_leader", "majority_whip", "minority_whip"]),
    nominationId: z.string().optional(),
  })
  .refine((data) => data.action !== "vote" || (data.nominationId && data.nominationId.length > 0), {
    message: "nominationId required when action is vote",
    path: ["nominationId"],
  });

export const senateLeadershipActionSchema = z
  .object({
    action: z.enum([
      "start_election",
      "reset_election",
      "force_end",
      "declare",
      "withdraw",
      "vote",
    ]),
    role: z.enum([
      "pro_tempore",
      "majority_leader",
      "minority_leader",
      "majority_whip",
      "minority_whip",
    ]),
    nominationId: z.string().optional(),
  })
  .refine((data) => data.action !== "vote" || (data.nominationId && data.nominationId.length > 0), {
    message: "nominationId required when action is vote",
    path: ["nominationId"],
  });

const LEADERSHIP_ROLES = [
  "speaker_of_the_house",
  "majority_leader_house",
  "minority_leader_house",
  "majority_whip_house",
  "minority_whip_house",
  "president_pro_tempore",
  "majority_leader_senate",
  "minority_leader_senate",
  "majority_whip_senate",
  "minority_whip_senate",
] as const;

export const leadersAssignSchema = z.object({
  role: z.enum(LEADERSHIP_ROLES),
  characterId: z.union([schemas.objectId, z.literal(""), z.null()]).optional(),
});

const policyProvisionSchema = z.object({
  legislationTypeId: z.string().min(1),
  policyOptionId: z.string().optional(),
  effectDirection: z.number(),
  economic: z.number().optional(),
  social: z.number().optional(),
  // Tax-slider laws (ruling #16): the slider-chosen rate. Server-side
  // validation (bounds/grid/min-step vs the CURRENT rate) runs in the route.
  proposedRate: z.number().optional(),
});

export const tariffProvisionSchema = z.object({
  type: z.literal("tariff"),
  scopeType: z.enum(["economy_wide", "sector", "origin_country", "corporation"]),
  targetSectorType: z.string().optional(),
  targetOriginCountryId: z.enum(ZOD_COUNTRY_ENUM).optional(),
  targetCorporationId: z.string().optional(),
  rate: z.number().min(0).max(100),
});

export const subsidyProvisionSchema = z.object({
  type: z.literal("subsidy"),
  scopeType: z.enum(["economy_wide", "sector"]),
  targetSectorType: z.string().optional(),
  targetStrategyId: z.string().optional(),
  domesticOnly: z.boolean(),
});

export const endSubsidyProvisionSchema = z.object({
  type: z.literal("end_subsidy"),
  scopeType: z.enum(["economy_wide", "sector"]),
  targetSectorType: z.string().optional(),
  targetStrategyId: z.string().optional(),
});

export const nationalizeProvisionSchema = z
  .object({
    type: z.literal("nationalize"),
    targetCorporationId: z.string().length(24).optional(),
    /** Industry-wide sector target (XOR `targetCorporationId`). */
    targetSectorType: z.enum(CORPORATION_TYPES).optional(),
    /** Carve fraction for a sector taking (0 < f ≤ 1); defaults to 1. */
    sectorCarveFraction: z.number().gt(0).max(1).optional(),
    /** Which pools the sector taking sweeps; defaults to "all". */
    sectorScope: z.enum(["all", "corporations", "unowned", "npp_unowned"]).optional(),
  })
  .refine((d) => !!d.targetCorporationId !== !!d.targetSectorType, {
    message: "Provide exactly one of targetCorporationId or targetSectorType",
  });

export const privatizeProvisionSchema = z.object({
  type: z.literal("privatize"),
  sourceNationalCorporationId: z.string().length(24),
  selections: z
    .array(z.object({ sectorId: z.string().length(24), carveFraction: z.number() }))
    .min(1)
    .max(10),
  newCorpName: z.string().trim().min(2).max(60),
  goldenSharePercent: z.number().min(0).max(1).default(0),
  method: z.enum(["ipo", "auction"]).default("ipo"),
  reservePrice: z.number().positive().optional(),
});

export const designateStrategicSectorProvisionSchema = z.object({
  type: z.literal("designate_strategic_sector"),
  sectorType: z.string().min(1),
});

const embargoCommoditySchema = z.union([z.enum(COMMODITY_TYPES), z.literal("all")]);

export const embargoProvisionSchema = z.object({
  type: z.literal("embargo"),
  targetCountry: z.enum(ZOD_COUNTRY_ENUM),
  commodity: embargoCommoditySchema,
  direction: z.enum(["export", "import", "both"]),
  mode: z.enum(["block", "cap"]),
  cap: z.number().min(0).optional(),
});

export const endEmbargoProvisionSchema = z.object({
  type: z.literal("end_embargo"),
  targetCountry: z.enum(ZOD_COUNTRY_ENUM),
  commodity: embargoCommoditySchema,
  direction: z.enum(["export", "import", "both"]),
});

/**
 * Strict policy-provision schema for SUB-NATIONAL (state/regional) bills.
 * Unlike the permissive national `policyProvisionSchema`, this requires a
 * non-empty legislationTypeId and an explicit effectDirection so arbitrary
 * payloads cannot flow into enactment (audit S6).
 */
export const stateBillPolicyProvisionSchema = z.object({
  type: z.literal("policy").optional(),
  legislationTypeId: z.string().min(1),
  policyOptionId: z.string().optional(),
  effectDirection: z.number(),
  economic: z.number().optional(),
  social: z.number().optional(),
});

/**
 * The complete set of provision types supported by sub-national bills
 * (see StateBillProvision in db/types/stateBill.ts). National-only provisions
 * (tariff, nationalize, privatize, embargo, international_organization, …)
 * are deliberately NOT accepted here — they execute direct treasury writes
 * and must never enter through a regional queue (audit S6).
 */
export const stateBillProvisionSchema = z.union([
  subsidyProvisionSchema,
  endSubsidyProvisionSchema,
  stateBillPolicyProvisionSchema,
]);

/**
 * Electoral law: franchise and registration access. Both fields optional, but
 * `validateElectoralLawProvision` rejects a provision that sets neither — the
 * schema cannot express "at least one of" cleanly enough to be worth it here,
 * and the shared validator is the single gate both proposal paths run through.
 */
export const electoralLawProvisionSchema = z.object({
  type: z.literal("electoral_law"),
  votingAge: z.number().int().min(16).max(25).optional(),
  registrationAccess: z.number().min(-50).max(50).optional(),
});

export const unionLawProvisionSchema = z.object({
  type: z.literal("union_law"),
  bias: z.number().min(-50).max(50),
  // Union ban (player suggestion #93): when present the provision is a
  // ban/repeal action instead of a bias law — see UnionLawProvision.
  banAction: z.enum(["ban", "repeal_ban"]).optional(),
});

/**
 * Bill titles become public page titles (bill pages, system wire posts, news
 * permalinks), so they get the stricter name-level filter. Summaries and full
 * text are body copy and follow the news-content policy: slurs only.
 */
export function moderatedBillTitle(base: z.ZodString = z.string().min(1, "Title required")) {
  return base.refine((value) => !containsBlockedName(value), {
    message: "Bill title contains prohibited language",
  });
}

export function moderatedBillText(base: z.ZodString) {
  return base.refine((value) => !containsSlur(value), {
    message: "Text contains prohibited language",
  });
}

export const proposeBillSchema = z
  .object({
    title: moderatedBillTitle(),
    summary: moderatedBillText(z.string().min(1, "Summary required")),
    chamber: z.enum([
      "house",
      "senate",
      "joint",
      "commons",
      "lords",
      "shugiin",
      "sangiin",
      "bundestag",
      "bundesrat",
      "dail",
      "seanad",
      "npc",
      "cppcc",
      "chamber",
    ]),
    category: z.enum(BILL_CATEGORIES),
    fullText: moderatedBillText(z.string()).optional(),
    provisions: z
      .array(
        z.union([
          tariffProvisionSchema,
          subsidyProvisionSchema,
          endSubsidyProvisionSchema,
          nationalizeProvisionSchema,
          privatizeProvisionSchema,
          designateStrategicSectorProvisionSchema,
          embargoProvisionSchema,
          endEmbargoProvisionSchema,
          unionLawProvisionSchema,
          electoralLawProvisionSchema,
          policyProvisionSchema,
        ])
      )
      .max(MAX_PROVISIONS, `At most ${MAX_PROVISIONS} provisions`),
    confirmElectionRisk: z.boolean().optional(),
  })
  // Custom (flavor/roleplay) bills carry no provisions; every other category
  // still requires at least one.
  .refine((data) => data.category === "custom" || data.provisions.length >= 1, {
    message: "At least 1 provision required",
    path: ["provisions"],
  });

export const billActionSchema = z.union([
  z.object({ action: z.literal("vote"), vote: z.enum(["for", "against", "abstain"]) }),
  z.object({ action: z.literal("cosponsor") }),
  z.object({ action: z.literal("uncosponsor") }),
  z.object({ action: z.literal("withdraw") }),
  z
    .object({
      action: z.literal("presidential_action"),
      decision: z.enum(["sign", "veto"]),
      vetoMessage: z.string().min(VETO_MESSAGE_MIN_LENGTH).max(VETO_MESSAGE_MAX_LENGTH).optional(),
    })
    .refine(
      (data) =>
        data.decision !== "veto" ||
        (data.vetoMessage?.trim().length ?? 0) >= VETO_MESSAGE_MIN_LENGTH,
      {
        message: `A veto requires a public message of at least ${VETO_MESSAGE_MIN_LENGTH} characters.`,
      }
    ),
  z.object({ action: z.literal("veto_override_vote"), vote: z.enum(["for", "against"]) }),
  z.object({ action: z.literal("filibuster") }),
]);
