/**
 * Cross-pressure resolver - pure functions that decide how an NPP votes on a
 * federal bill. No DB access, no random. Replaces the RNG-based ideology +
 * whip-roll path for federal bill voting.
 *
 * The model: every vote is the deterministic sum of four signed forces, each
 * clamped to [-100, +100]. Positive pulls FOR, negative pulls AGAINST. Verdict
 * thresholds: sum > +5 -> FOR, sum < -5 -> AGAINST, otherwise ABSTAIN.
 *
 * | Force    | Where it comes from                                                 |
 * | -------- | ------------------------------------------------------------------- |
 * | ideology | NPP ideology aligned to the selected policy option vector           |
 * | whip     | Party whip + caucus whip, gated by loyalty/stubbornness             |
 * | district | Selected policy option's archetype approvals weighted by home-state |
 * | donors   | Donor base multiplied by the same policy alignment as ideology      |
 */

import type {
  Bill,
  LegislationPolicyOption,
  LegislationType,
  NPP,
  PolicyProvision,
  StateBill,
  StateDemographics,
} from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import { isNewGenerationType } from "@/lib/politicalLegislation/project";
import type { CrossPressureForces } from "@/lib/db/types/nppVotePrediction";

export type CrossPressureVerdict = "for" | "against" | "abstain";

/**
 * Minimal whip-direction shape consumed by the resolver. Callers commonly pass
 * `BillWhip` records here, but synthetic directives work too - the resolver
 * only reads `direction`.
 */
export interface CrossPressureWhipDirective {
  direction: "for" | "against";
  mode?: "soft" | "hard";
}

/**
 * Whip data presented to the resolver. The resolver does not look anything up.
 * Call sites resolve the appropriate party whip and pass it as `partyWhip`.
 */
export interface CrossPressureWhipInputs {
  partyWhip: CrossPressureWhipDirective | null;
  /** Reserved for caucus whips. */
  caucusWhip: CrossPressureWhipDirective | null;
  /** True if the bill aligns with one of the NPP's caucus's CORE positions. */
  alignsCorePosition?: boolean;
}

export interface CrossPressureContext {
  /** Resolved by the caller from `bill.legislationTypeId`. */
  legislationType: LegislationType | null;
  /** Resolved by the caller from `npp.homeState`. */
  homeStateDemographics: StateDemographics | null;
  whips: CrossPressureWhipInputs;
  /**
   * Optional per-force multipliers so local bill voting can lean harder on
   * home-region sentiment without duplicating the full federal resolver.
   */
  weights?: Partial<{
    ideology: number;
    whip: number;
    district: number;
    donors: number;
  }>;
}

type CrossPressureBill = Pick<Bill, "legislationTypeId" | "effectDirection" | "provisions"> &
  Partial<Pick<Bill, "currentChamber">> &
  Partial<Pick<StateBill, "stateId">>;

// Narrow dead zone: only near-tied cross-pressure produces abstain.
const VERDICT_THRESHOLD = 5;

/** Clamp `n` into [-100, 100]. */
function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n > 100) return 100;
  if (n < -100) return -100;
  return n;
}

/** Resolve the bill's primary policy provision, if any. */
function findPolicyProvision(bill: CrossPressureBill): PolicyProvision | null {
  const provisions = bill.provisions ?? [];
  for (const provision of provisions) {
    if (isPolicyProvision(provision)) return provision;
  }

  // Legacy bills may have legislationTypeId/effectDirection at the top level
  // without an explicit provisions array.
  if (bill.legislationTypeId && bill.effectDirection != null) {
    return {
      legislationTypeId: bill.legislationTypeId,
      policyOptionId: undefined,
      effectDirection: bill.effectDirection,
    };
  }
  return null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function findPolicyOption(
  provision: PolicyProvision,
  legislationType: LegislationType | null
): LegislationPolicyOption | null {
  const options = legislationType?.policyOptions ?? [];
  if (!provision.policyOptionId) return null;
  return options.find((option) => option.id === provision.policyOptionId) ?? null;
}

function vectorFromProvision(
  provision: PolicyProvision,
  legislationType: LegislationType | null
): { economic: number; social: number } | null {
  const provisionEconomic = finiteNumber(provision.economic) ? provision.economic : undefined;
  const provisionSocial = finiteNumber(provision.social) ? provision.social : undefined;

  if (
    provisionEconomic !== undefined &&
    provisionSocial !== undefined &&
    (provisionEconomic !== 0 || provisionSocial !== 0)
  ) {
    return { economic: provisionEconomic, social: provisionSocial };
  }

  const option = findPolicyOption(provision, legislationType);
  if (option && (option.economic !== 0 || option.social !== 0)) {
    return { economic: option.economic, social: option.social };
  }

  // Last structured fallback: infer the policy vector from options that move
  // the same underlying metric in the same direction. This is intentionally
  // weaker than a selected policyOptionId, but avoids treating metric direction
  // itself as a left/right signal.
  const sameDirection = (legislationType?.policyOptions ?? []).filter((candidate) => {
    return (
      candidate.effectDirection === provision.effectDirection &&
      (candidate.economic !== 0 || candidate.social !== 0)
    );
  });
  if (sameDirection.length === 0) return null;

  return {
    economic:
      sameDirection.reduce((sum, candidate) => sum + candidate.economic, 0) / sameDirection.length,
    social:
      sameDirection.reduce((sum, candidate) => sum + candidate.social, 0) / sameDirection.length,
  };
}

function alignmentFromPolicyVector(npp: NPP, vector: { economic: number; social: number }): number {
  const magnitude = Math.hypot(vector.economic, vector.social);
  if (magnitude === 0) return 0;

  const economic = npp.policies?.economic ?? 0;
  const social = npp.policies?.social ?? 0;
  const projection = (economic * vector.economic + social * vector.social) / magnitude;
  return Math.max(-1, Math.min(1, projection / 5));
}

function computePolicyAlignment(
  npp: NPP,
  bill: CrossPressureBill,
  legislationType: LegislationType | null
): number | null {
  const provision = findPolicyProvision(bill);
  if (!provision) return null;

  const vector = vectorFromProvision(provision, legislationType);
  if (vector) return alignmentFromPolicyVector(npp, vector);
  if (provision.effectDirection === 0) return 0;

  const domainStance = npp.policies?.domainPositions?.[provision.legislationTypeId];
  if (typeof domainStance === "number") {
    return Math.max(-1, Math.min(1, (domainStance / 5) * provision.effectDirection));
  }

  // Generation guard (political-legislation spec §6, owner ruling #13):
  // new-generation bills never enter the inverted-polarity legacy fallback —
  // no vector and no domain stance means alignment 0, so lean-0 laws genuinely
  // carry no ideological force and NPPs decide them on their non-ideological
  // heuristics (party line, sponsor relationship, whip pressure).
  if (isNewGenerationType(legislationType)) {
    return 0;
  }

  // Legacy fallback for old bills that only stored effectDirection. Under the
  // old convention, positive direction generally meant the leftward branch, so
  // invert economic because economic -5 is left and +5 is right.
  const economic = npp.policies?.economic ?? 0;
  return Math.max(-1, Math.min(1, (-economic / 5) * provision.effectDirection));
}

/**
 * Ideology force based on policy-vector alignment.
 *
 * `effectDirection` is a metric direction, not an ideology direction. Modern
 * bills therefore use provision/option `economic` and `social` vectors first.
 */
export function computeIdeologyForce(
  npp: NPP,
  bill: CrossPressureBill,
  legislationType: LegislationType | null = null
): number {
  const alignment = computePolicyAlignment(npp, bill, legislationType);
  if (alignment == null) return 0;
  return clamp100(alignment * 100);
}

/**
 * Compliance gate - how strongly the NPP responds to whips. Mirrors the
 * existing personality model: loyal NPPs follow the whip, stubborn NPPs resist.
 */
export function complianceMultiplier(npp: NPP): number {
  const loyalty = (npp.personality?.loyalty ?? 50) / 100;
  const stubbornness = (npp.personality?.stubbornness ?? 50) / 100;
  return loyalty * 0.7 + (1 - stubbornness) * 0.3;
}

const PARTY_WHIP_BASE_BY_MODE = { hard: 60, soft: 30 } as const;
const CAUCUS_WHIP_BASE_BY_MODE = { hard: 80, soft: 40, free: 0 } as const;
const CORE_POSITION_BONUS = 20;

/**
 * Baseline magnitude for the party-line default before compliance scaling.
 * Chosen to be softer than a soft whip (30 × compliance) so an explicit
 * whip always dominates, but large enough to break zero-force ties.
 */
const PARTY_LINE_BIAS_BASE = 20;

/**
 * Whip force: directional pull from the active party + caucus whips, gated by
 * the NPP's personality compliance.
 */
export function computeWhipForce(npp: NPP, whips: CrossPressureWhipInputs): number {
  let raw = 0;
  if (whips.partyWhip) {
    const mode = whips.partyWhip.mode ?? "hard";
    const magnitude = PARTY_WHIP_BASE_BY_MODE[mode];
    raw += whips.partyWhip.direction === "for" ? magnitude : -magnitude;
  }
  if (whips.caucusWhip) {
    const mag = CAUCUS_WHIP_BASE_BY_MODE.soft;
    raw += whips.caucusWhip.direction === "for" ? mag : -mag;
    if (whips.alignsCorePosition) {
      raw += whips.caucusWhip.direction === "for" ? CORE_POSITION_BONUS : -CORE_POSITION_BONUS;
    }
  }
  if (raw === 0) return 0;
  return clamp100(raw * complianceMultiplier(npp));
}

/**
 * Party-line default force: when an NPP is in the same party as the bill
 * sponsor and no explicit whip is set, co-partisan legislators lean FOR by
 * default. Scaled by the compliance multiplier so low-loyalty/high-stubbornness
 * NPPs feel it less. Returns 0 for opposition or unaffiliated NPPs.
 *
 * Call sites should only apply this when `applicableWhip === null` to avoid
 * double-counting alongside an explicit party whip.
 */
export function computePartyLineForce(npp: NPP, sponsorParty: string | undefined): number {
  if (!sponsorParty || !npp.party || npp.party !== sponsorParty) return 0;
  return PARTY_LINE_BIAS_BASE * complianceMultiplier(npp);
}

/**
 * District force: population-weighted approval of the bill's selected policy
 * option across the archetypes present in the NPP's home state.
 */
export function computeDistrictForce(
  bill: CrossPressureBill,
  legislationType: LegislationType | null,
  homeStateDemographics: StateDemographics | null
): number {
  if (!legislationType || !homeStateDemographics) return 0;
  const provision = findPolicyProvision(bill);
  if (!provision || !provision.policyOptionId) return 0;

  const option = legislationType.policyOptions?.find((o) => o.id === provision.policyOptionId);
  if (!option) return 0;

  const approvals = option.archetypeApprovals ?? option.groupApprovals;
  if (!approvals) return 0;

  const groups = homeStateDemographics.groups;
  if (!groups) return 0;

  let totalPop = 0;
  for (const archetypeId of Object.keys(groups)) {
    const group = groups[archetypeId];
    if (group && Number.isFinite(group.population)) totalPop += group.population;
  }
  if (totalPop <= 0) return 0;

  let weighted = 0;
  for (const [archetypeId, approval] of Object.entries(approvals)) {
    if (typeof approval !== "number" || !Number.isFinite(approval)) continue;
    const group = groups[archetypeId];
    if (!group) continue;
    weighted += (group.population / totalPop) * approval;
  }
  return clamp100(weighted);
}

/**
 * Donors force + narrative label. Donors follow the same policy alignment as
 * ideology, scaled by donorBaseLevel (0..5).
 */
export function computeDonorsForce(
  npp: NPP,
  bill: CrossPressureBill,
  legislationType: LegislationType | null = null
): { force: number; label: string } {
  const donorLevel = Math.max(0, Math.min(5, npp.donorBaseLevel ?? 0));
  if (donorLevel === 0) {
    return { force: 0, label: "No donor base - donors silent on this vote" };
  }

  const provision = findPolicyProvision(bill);
  if (!provision) {
    return { force: 0, label: `L${donorLevel} donor base - bill is not policy-coded` };
  }

  const alignment = computePolicyAlignment(npp, bill, legislationType);
  if (alignment == null || alignment === 0) {
    return {
      force: 0,
      label: `L${donorLevel} donor base - no clear policy alignment on this issue`,
    };
  }

  const force = clamp100((donorLevel / 5) * alignment * 100);
  if (Math.abs(force) < 5) {
    return {
      force,
      label: `L${donorLevel} donors split - NPP's stance only weakly aligns with bill`,
    };
  }
  if (force > 0) {
    return {
      force,
      label: `L${donorLevel} donor base - stance aligns with bill - donors push FOR`,
    };
  }
  return {
    force,
    label: `L${donorLevel} donor base - stance opposes bill - donors push AGAINST`,
  };
}

/**
 * Compose all four forces. Pure: no DB access, no random. Returns the force
 * vector + the donors narrative label. Verdict is computed via
 * `verdictFromForces`.
 */
export function computeCrossPressureForces(
  npp: NPP,
  bill: CrossPressureBill,
  ctx: CrossPressureContext
): { forces: CrossPressureForces; donorsLabel: string } {
  const weights = {
    ideology: ctx.weights?.ideology ?? 1,
    whip: ctx.weights?.whip ?? 1,
    district: ctx.weights?.district ?? 1,
    donors: ctx.weights?.donors ?? 1,
  };
  const ideology = clamp100(
    computeIdeologyForce(npp, bill, ctx.legislationType) * weights.ideology
  );
  const whip = clamp100(computeWhipForce(npp, ctx.whips) * weights.whip);
  const district = clamp100(
    computeDistrictForce(bill, ctx.legislationType, ctx.homeStateDemographics) * weights.district
  );
  const donorsResult = computeDonorsForce(npp, bill, ctx.legislationType);
  return {
    forces: {
      ideology,
      whip,
      district,
      donors: clamp100(donorsResult.force * weights.donors),
    },
    donorsLabel: donorsResult.label,
  };
}

/**
 * Threshold rule: |sum| <= 5 -> ABSTAIN; otherwise the sign of the sum decides.
 */
export function verdictFromForces(forces: CrossPressureForces): CrossPressureVerdict {
  const sum = forces.ideology + forces.whip + forces.district + forces.donors;
  if (sum > VERDICT_THRESHOLD) return "for";
  if (sum < -VERDICT_THRESHOLD) return "against";
  return "abstain";
}
