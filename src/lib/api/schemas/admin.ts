import { z } from "zod";
import { schemas } from "../validate";
import { countryIdSchema } from "@/lib/api/schemas/country";

// admin/feedback/[id] PATCH
export const adminFeedbackPatchSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "wont_fix"]).optional(),
  adminNotes: z.string().max(5000).optional(),
});

// admin/suggestions/[id] PATCH — player suggestion forum (`suggestions` collection)
export const adminSuggestionPatchSchema = z.object({
  status: z
    .enum(["not_reviewed", "planned", "in_progress", "completed", "not_implementing"])
    .optional(),
  adminNotes: z.string().max(5000).optional(),
});

// admin/suggestions/merge POST
export const adminSuggestionMergeSchema = z.object({
  targetIssueNumber: z.number().int().min(1),
  sourceIssueNumbers: z.array(z.number().int().min(1)).min(1),
});

// admin/suggestions/bulk-delete POST
export const adminSuggestionBulkDeleteSchema = z.object({
  issueNumbers: z.array(z.number().int().min(1)).min(1),
});

// admin/state/[id]/assign-seat POST
export const adminAssignSeatSchema = z
  .object({
    // `seatType` is an `officeType` key (governor / senate / house / npcDelegate /
    // dail / chamber / …). The route validates it against the country's
    // `getRegionAppointableSeats` whitelist, so the schema only enforces a
    // non-empty string here rather than a hand-maintained per-country enum.
    seatType: z.string().min(1),
    senateClass: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    entityId: schemas.objectId,
    entityType: z.enum(["player", "npp"]),
    seatsToAssign: z.number().int().min(1).optional().default(1),
  })
  .refine((d) => d.seatType !== "senate" || d.senateClass !== undefined, {
    message: "Senate class required for senate seats",
    path: ["senateClass"],
  });

// admin/state/[id]/remove-official POST
export const adminRemoveOfficialSchema = z.object({
  officialId: schemas.objectId,
});

// admin/npps POST
export const adminNppsSchema = z.object({
  action: z.enum(["generate", "remove", "spawn", "backfill_images"]),
  states: z.array(z.string()).optional(),
  parties: z.array(z.string()).optional(),
  // Country-aware party data for generate action
  partyData: z.array(z.object({ countryId: z.string(), partyId: z.string() })).optional(),
  count: z.number().int().min(1).max(500).optional(),
  party: z.string().optional(),
  countryId: z.string().optional(), // For spawn action
  preferMode: z.enum(["lean", "members", "both"]).optional(),
});

// admin/bills POST
export const adminBillsSchema = z.object({
  action: z.enum([
    "force_sign",
    "force_veto",
    "force_fail",
    "force_enroll",
    "force_advance_chamber",
    "reset",
  ]),
  billId: schemas.objectId,
});

// admin/state-party/[stateId]/[partyId]/appoint POST
export const adminStatePartyAppointSchema = z.object({
  position: z.enum(["chair", "viceChair", "treasurer"]),
  characterId: z.union([schemas.objectId, z.null()]),
});

// admin/state-party-elections POST
export const adminStatePartyElectionsSchema = z.object({
  action: z.enum(["batch-resolve", "batch-create"]),
  durationTurns: z.number().int().positive().optional(),
});

// admin/users/reset-password POST
export const adminResetPasswordSchema = z.object({
  userId: schemas.objectId,
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

// admin/users/delete POST
export const adminDeleteUserSchema = z.object({
  userId: schemas.objectId,
});

// admin/users/ban POST
export const adminBanUserSchema = z.object({
  userId: schemas.objectId,
  ban: z.boolean(),
  reason: z.string().nullish(),
});

// admin/resources/grant POST
export const adminResourcesGrantSchema = z
  .object({
    characterIds: z.array(schemas.objectId).optional(),
    allPlayers: z.boolean().optional(),
    actions: z.number().min(-10000).max(10000).optional(),
    funds: z.number().min(-100000000).max(100000000).optional(),
    cashOnHand: z.number().min(-100000000).max(100000000).optional(),
    currency: z.enum(["USD", "GBP", "JPY", "CAD", "EUR"]).optional(),
  })
  .refine(
    (d) =>
      (d.actions !== undefined && d.actions !== 0) ||
      (d.funds !== undefined && d.funds !== 0) ||
      (d.cashOnHand !== undefined && d.cashOnHand !== 0),
    {
      message: "Must specify at least one resource to grant (actions, funds, or cashOnHand)",
      path: ["actions"],
    }
  )
  .refine((d) => d.allPlayers === true || (d.characterIds && d.characterIds.length > 0), {
    message: "Must specify characterIds or set allPlayers to true",
    path: ["characterIds"],
  });

// admin/party-org PATCH
export const adminPartyOrgPatchSchema = z.object({
  stateId: z.string().min(1),
  countryId: z.string().min(2).max(3),
  partyId: z.string().min(1),
  organization: z.number().optional(),
});

// admin/officials/appoint POST
export const adminOfficialsAppointSchema = z
  .object({
    officialId: schemas.objectId.optional(),
    characterId: z.union([schemas.objectId, z.null()]).optional(),
    officeType: z.literal("house").optional(),
    state: z.string().optional(),
    seatsHeld: z.number().int().positive().optional(),
  })
  .refine(
    (d) => {
      if (d.officeType === "house" && d.state && d.seatsHeld && d.characterId) return true;
      if (d.officialId) return true;
      return false;
    },
    { message: "Either (officeType=house, state, seatsHeld, characterId) or officialId required" }
  );

// admin/elections POST
export const adminElectionsCreateSchema = z
  .object({
    cycle: z.number().int(),
    senateClass: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    includeHouse: z.boolean().optional(),
    includeStateSenate: z.boolean().optional(),
    includeGovernor: z.boolean().optional(),
  })
  .refine((d) => d.includeHouse || d.senateClass || d.includeStateSenate || d.includeGovernor, {
    message: "Must select at least one election type to create",
  })
  .refine(
    (d) =>
      !(d.includeHouse || d.senateClass) || (d.senateClass && [1, 2, 3].includes(d.senateClass)),
    {
      message: "Valid senate class (1, 2, or 3) required for federal elections",
      path: ["senateClass"],
    }
  );

// admin/elections PATCH
export const adminElectionsPatchSchema = z
  .object({
    action: z.enum(["set", "add", "subtract"]),
    electionType: z
      .enum([
        "senate",
        "house",
        "stateSenate",
        "governor",
        "commons",
        "snap_commons",
        "regionalCouncil",
        "president",
        "shugiin",
        "sangiin",
        "snap_shugiin",
        "bundestag",
        "snap_bundestag",
        "ministerPresident",
        "landtag",
        "npcDelegate",
        "peoplesCongress",
      ])
      .optional(),
    state: z.string().optional(),
    countryId: countryIdSchema.optional(),
    senateClass: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    chamberClass: z.union([z.literal(1), z.literal(2)]).optional(),
    cycle: z.number().optional(),
    primaryHours: z.number().min(0).optional(),
    generalHours: z.number().min(0).optional(),
  })
  .refine((d) => d.primaryHours !== undefined || d.generalHours !== undefined, {
    message: "Must provide primaryHours and/or generalHours",
  });

// admin/demographics POST
export const adminDemographicsPostSchema = z.object({
  confirmText: z.literal("OVERWRITE"),
});

// admin/turn/batch POST
export const adminTurnBatchSchema = z.object({
  count: z.number().int().min(1).max(20),
});

// admin/law-types POST
const effectTargetSchema = z.object({
  metricCategoryId: z.enum([
    "economic",
    "education",
    "healthcare",
    "infrastructure",
    "publicSafety",
    "environment",
    "social",
    "governance",
    "population",
    "mediaInformation",
  ]),
  metricId: z.string().min(1),
  strength: z.enum(["weak", "moderate", "strong"]),
});

const demographicTargetingSchema = z.object({
  groupId: z.string().min(1),
  weight: z.enum(["low", "medium", "high"]),
  stance: z.enum(["support", "oppose"]),
});

const positionSchema = z.object({
  positionId: z.string().min(1),
  name: z.string().min(1),
  // Must stay in sync with LegislationTypePosition["chamber"] (src/lib/db/types/legislation.ts)
  chamber: z.enum([
    "house",
    "senate",
    "commons",
    "lords",
    "shugiin",
    "sangiin",
    "bundestag",
    "landtag",
    "dail",
    "seanad",
    "npc",
    "cppcc",
    "peoplesCongress",
  ]),
});

const policyOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  stance: z.enum(["left", "center", "right"]),
  effectDirection: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  economic: z.number(),
  social: z.number(),
});

export const adminLawTypesCreateSchema = z.object({
  _id: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "ID must be snake_case (lowercase, underscores, start with letter)"
    ),
  name: z.string().min(1),
  policyDomain: z.string().min(1),
  description: z.string().optional(),
  subCategory: z.string().optional(),
  allowedScope: z.enum(["national", "state", "both"]).optional(),
  effectTargets: z.array(effectTargetSchema).optional(),
  demographicTargeting: z.array(demographicTargetingSchema).optional(),
  positions: z.array(positionSchema).optional(),
  policyOptions: z.array(policyOptionSchema).optional(),
  budgetCost: z.number().min(0).max(100).optional(),
  budgetCategory: z.string().optional(),
  isPermanent: z.boolean().optional(),
});
