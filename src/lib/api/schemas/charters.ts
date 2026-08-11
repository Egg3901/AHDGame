import { z } from "zod";
import { containsBlockedName } from "@/lib/moderation";
import { PLATFORM_AXIS_MAX, PLATFORM_AXIS_MIN } from "@/lib/charters/overtonGuardrails";

const moderatedName = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be ${max} characters or less`)
    .refine((v) => !containsBlockedName(v), {
      message: `${label} contains prohibited language`,
    });

const axisSchema = z.coerce.number().min(PLATFORM_AXIS_MIN).max(PLATFORM_AXIS_MAX);

export const platformSchema = z.object({
  economic: axisSchema,
  social: axisSchema,
});

const objectIdHex = z.string().regex(/^[a-f0-9]{24}$/i, "Must be a 24-char hex ObjectId");

/**
 * Per-NPP party-position grid bound. Matches the NPP.policies +
 * PoliticalParty position scale (-5..+5). See `axisToPartyPosition` in
 * `ratifyCharter` for the charter-axis → party-position conversion.
 */
const partyPositionSchema = z.coerce.number().min(-5).max(5);

const foundingCohortPickSchema = z.object({
  /** State/region ID; must equal chair's home state or be in its adjacency. Server-side enforced in `draftCharter`. */
  stateId: z
    .string()
    .min(1, "stateId required")
    .max(32, "stateId too long")
    .regex(/^[A-Z0-9_]+$/, "stateId must be uppercase alphanumeric/underscore"),
  economicPosition: partyPositionSchema,
  socialPosition: partyPositionSchema,
});

export const draftCharterSchema = z.object({
  name: moderatedName("Name", 3, 50),
  abbreviation: z
    .string()
    .min(2, "Abbreviation must be at least 2 characters")
    .max(5)
    .regex(/^[A-Za-z0-9]+$/, "Abbreviation must be alphanumeric"),
  platform: platformSchema,
  /**
   * Three founder characterIds (24-char hex ObjectIds). Must include the
   * proposer's character. Same `userId` may back multiple character
   * entries (multi-persona play / admin testing) — uniqueness is at the
   * character level.
   */
  foundersCharacterIds: z.array(objectIdHex).length(3, "Exactly 3 founders required"),
  /**
   * F4 founding-cohort picks — two player-positionable NPPs in adjacent
   * states. Optional for backward-compat with legacy clients; absent →
   * draftCharter stores no cohort and ratification falls back to the
   * legacy 5-in-home-state path.
   *
   * Each pick's stateId is validated against the chair's home state
   * adjacency at draftCharter time (network-level reject if out of range).
   */
  foundingCohort: z.tuple([foundingCohortPickSchema, foundingCohortPickSchema]).optional(),
});

export const signCharterSchema = z.object({}).strict();

export const rejectCharterSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const replaceFounderSchema = z.object({
  outgoingCharacterId: objectIdHex,
  replacementCharacterId: objectIdHex,
});
