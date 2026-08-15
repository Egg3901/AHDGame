import { z } from "zod";
import { containsBlockedName } from "@/lib/moderation";
import { schemas } from "@/lib/api/validate";

function moderatedNameSchema(label: string, minLength: number, maxLength: number) {
  return z
    .string()
    .trim()
    .min(minLength, `${label} must be at least ${minLength} characters`)
    .max(maxLength, `${label} must be ${maxLength} characters or less`)
    .refine((value) => !containsBlockedName(value), {
      message: `${label} contains prohibited language`,
    });
}

export const createProposalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rename"),
    newName: z.string().trim().min(1).max(40),
    newAbbreviation: z.string().trim().min(1).max(6),
  }),
  z.object({
    type: z.literal("positionShift"),
    // Economic and social only — the axes the engines actually read.
    // `foreignPolicy` / `culture` were offered by the 2026-05-22 redesign
    // but nothing consumed them, so they were removed (ticket #1032).
    // Each axis has its own 336-turn cooldown enforced via
    // `PoliticalParty.positionShiftCooldowns`.
    axis: z.enum(["economic", "social"]),
    direction: z.union([z.literal(1), z.literal(-1)]),
  }),
  z.object({
    type: z.literal("merge"),
    targetPartyId: schemas.objectId,
  }),
  z.object({
    type: z.literal("electionMethod"),
    method: z.enum(["party", "committee", "influence"]),
  }),
  z.object({
    type: z.literal("electionDuration"),
    durationTurns: z.number().int().min(168).max(420),
  }),
  z.object({
    type: z.literal("removeOfficeHolder"),
    // Chair, vice-chair, treasurer, committee members, and
    // committee-confirmed campaigners are subject to committee removal.
    // Treasurer removal (tickets #1100, #285) lets the committee dislodge
    // an unopposed incumbent that the leadership election can't unseat.
    role: z.enum(["chair", "viceChair", "treasurer", "committeeMember", "campaigner"]),
    targetCharacterId: schemas.objectId,
  }),
  z.object({
    // Chair nomination of a Campaigner, confirmed by the National
    // Committee. Created by the campaigners route rather than the
    // generic proposal modal, but validated by the same union.
    type: z.literal("campaignerAppointment"),
    targetCharacterId: schemas.objectId,
  }),
  z.object({
    type: z.literal("transactionApprovalMode"),
    // Toggles `PoliticalParty.transactionApprovalMode`. The route
    // rejects a proposal whose `mode` matches the party's current
    // setting (no-op proposals not allowed).
    mode: z.enum(["single", "double"]),
  }),
]);

export const castProposalVoteSchema = z.object({
  vote: z.enum(["yes", "no"]),
});

/**
 * POST /api/country/[code]/parties/[id]/priority-region — set the
 * chair-tunable Priority Region cluster (2-4 connected adjacent states).
 * Per-state existence is validated at the route layer against the
 * `states` collection; shape + size + connectedness validated by
 * `validatePriorityRegionCluster`.
 */
export const setPriorityRegionSchema = z.object({
  stateIds: z.array(z.string().trim().min(1).max(32)).min(2).max(4),
});

export const createPartySchema = z.object({
  name: moderatedNameSchema("Name", 3, 50),
  abbreviation: z.string().min(2, "Abbreviation must be at least 2 characters").max(5),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex (e.g. #FF5733)"),
  economicPosition: z.coerce.number().min(-5).max(5),
  socialPosition: z.coerce.number().min(-5).max(5),
  // US: 4 selected + locked home = 5 max, UK: 2 regions
  selectedStates: z.array(z.string()).min(2).max(5).optional(),
});
