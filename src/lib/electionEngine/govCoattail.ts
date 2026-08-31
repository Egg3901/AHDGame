import type { Db } from "mongodb";
import { findMergedRegionMetrics, findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type { CountryId } from "@/lib/constants/countries";
import type { GameState } from "@/lib/db/types";
import type { StateApprovalHistory } from "@/lib/db/types/stateApproval";
import { resolveGameYear } from "@/lib/era/era";
import { getRegionalExecutive } from "@/lib/states/regionalExecutive";
import {
  BASE_APPROVAL,
  calculateStateApproval,
  computeNationalAveragesFromMetrics,
  loadElectorateGroups,
  weightingFor,
} from "@/lib/utils/governmentApproval";
import {
  isPoliticalApprovalCountry,
  loadPoliticalApprovalBases,
} from "@/lib/politicalLegislation/politicalApprovalProvider";
import { approvalCoattailMultiplier, coattailMultiplierMapToPct } from "./coattailMagnitude";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * A down-ballot general qualifies for the governor coattail when:
 *   - it is the general phase (primaries use a different engine), AND
 *   - it is NOT the executive's own office (no self-coattail), AND
 *   - it is NOT the head-of-government / presidential race (national).
 */
export function isCoattailEligibleRace(args: {
  isGeneralElection: boolean;
  electionType: string;
  regionalExecOfficeType: string | null;
  isOwnHeadOfGovernmentRace: boolean;
}): boolean {
  if (!args.isGeneralElection) return false;
  if (args.isOwnHeadOfGovernmentRace) return false;
  if (args.regionalExecOfficeType && args.electionType === args.regionalExecOfficeType)
    return false;
  return true;
}

/**
 * True when the race IS the sitting regional executive's own seat — the
 * in-state case `isCoattailEligibleRace` deliberately excludes. Used to feed
 * the governor's approval into the incumbency driver for their own
 * re-election. Single-winner regional executives only; legislatures never
 * qualify.
 *
 * The head-of-government race (US President) is intentionally NOT covered: the
 * presidential engine already folds approval into a dedicated nominal-share
 * `strengthMultiplier`, so routing it through the incumbency driver too would
 * double-count. See `2026-06-22-incumbency-approval-bonus-design.md`.
 */
export function isOwnRegionalExecutiveRace(args: {
  isGeneralElection: boolean;
  electionType: string;
  regionalExecOfficeType: string | null;
  hasState: boolean;
}): boolean {
  if (!args.isGeneralElection) return false;
  return (
    args.hasState &&
    args.regionalExecOfficeType != null &&
    args.electionType === args.regionalExecOfficeType
  );
}

/**
 * Build the per-party coattail multiplier map. Only the executive's party gets
 * an entry, and only when that party actually has a StatePartyOrg row in this
 * state (so a stale `electedOfficials.party` value silently no-ops to neutral).
 *
 * Magnitude is approval-based (2026-06-02 design): a governor at the neutral
 * approval baseline is 1.0x; above it lifts (up to +COATTAIL_MAX_BONUS at
 * +COATTAIL_APPROVAL_SATURATION points), below it drags (down to
 * 1 - COATTAIL_MAX_BONUS).
 */
export function buildGovModifierByParty(
  governor: { partyId: string; approval: number } | null,
  partyIdsInState: Set<string>
): Map<string, number> {
  const map = new Map<string, number>();
  if (!governor) return map;
  if (!partyIdsInState.has(governor.partyId)) return map;
  map.set(governor.partyId, approvalCoattailMultiplier(governor.approval));
  return map;
}

/**
 * Convert a govModifier multiplier map into signed percentage tilts for display
 * (e.g. 1.045 → +4.5). Pure; used by the persuasion-drivers card.
 */
export function govModifierToPct(modifier: Map<string, number>): Record<string, number> {
  return coattailMultiplierMapToPct(modifier);
}

/**
 * Resolve the sitting regional executive's party and their state's approval.
 * Returns null when the office is vacant / has no party, or the state has no
 * metrics. Approval uses the base computation (state metrics vs national
 * averages); State-of-the-State address bumps are a future refinement.
 *
 * Shared by the turn engine (→ `buildGovModifierByParty`) and the election
 * display (→ `govModifierToPct`) so both see the same magnitude.
 */
export async function resolveGovExecutiveApproval(
  db: Db,
  countryId: CountryId,
  stateId: string
): Promise<{ partyId: string; approval: number } | null> {
  const exec = await getRegionalExecutive(db, countryId, stateId);
  if (!exec?.partyId) return null;

  // Prefer the stored per-turn snapshot (issue #2891 item 1): the snapshot is
  // damped at APPROVAL_MAX_STEP_PER_TURN points/turn, so coattail magnitudes
  // glide instead of jumping when metrics shock. Mirrors the presidential
  // coattail, which already reads the stored national rating. Falls back to
  // the live computation when no snapshot exists yet (fresh seed).
  const snapshot = await db
    .collection<StateApprovalHistory>("stateApprovalHistory")
    .findOne({ _id: stateId.toUpperCase(), countryId }, { projection: { approvalRating: 1 } });
  if (snapshot && Number.isFinite(snapshot.approvalRating)) {
    return { partyId: exec.partyId, approval: snapshot.approvalRating };
  }

  // SP5: merged two-store views.
  const stateMetrics = await findMergedRegionMetrics(db, {
    _id: stateId.toUpperCase(),
    countryId,
  });
  if (!stateMetrics) return null;

  const [allMetrics, groupsByState, gameStateDoc] = await Promise.all([
    findMergedRegionMetricsMany(db, { countryId }),
    loadElectorateGroups(db, { countryId, _id: stateId.toUpperCase() }),
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
  ]);
  const nationalAverages = computeNationalAveragesFromMetrics(allMetrics);
  const preset = gameStateDoc?.preset ?? DEFAULT_SEED_PRESET;
  // Live year for era-aware scoring; null while the flag is off (legacy path).
  const year = gameStateDoc?.eraSystemEnabled ? resolveGameYear(gameStateDoc) : null;
  // SP4: playable-country live fallback reads the hybrid political base.
  let baseOverride: number | undefined;
  if (isPoliticalApprovalCountry(countryId)) {
    const bases = await loadPoliticalApprovalBases(db, countryId);
    baseOverride = bases?.byRegion.get(stateId.toUpperCase()) ?? BASE_APPROVAL;
  }
  // P6d: electorate-weighted, matching the stored/displayed approval.
  const approval = calculateStateApproval(
    stateMetrics,
    nationalAverages,
    [],
    weightingFor(groupsByState, countryId, stateId.toUpperCase()),
    preset,
    year,
    baseOverride
  );

  return { partyId: exec.partyId, approval };
}
