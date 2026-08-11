import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PartyStrengthPressure, StatePartyOrg, PoliticalParty } from "@/lib/db/types";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { checkPartyPresence } from "@/lib/turn/partyOrg/presence";
import {
  canSpendOnStateParty,
  resolveSpenderScope,
  resolveSpenderScopeEligibility,
  type SpenderScopeEligibility,
} from "@/lib/parties/access";
import {
  BUILD_ORG_BASE_PS_COST,
  PRIORITY_REGION_EFFECT_BONUS,
  effectivePsCost,
  blendedComparisonPs,
} from "@/lib/turn/politicalStrength/strengthConstants";
import {
  calcUnifiedBuildOrg,
  type UnifiedBuildOrgBreakdown,
} from "@/lib/turn/politicalStrength/buildOrgGain";
import { isStateInPriorityRegion } from "@/lib/parties/priorityRegion";
import { resolveUnmannedDefaultCaptureMultiplier } from "@/lib/parties/unmannedDefenseShield";

/**
 * Canonical Build Org projection — the single source of truth shared by the
 * read-only preview GET route and the spend POST route (which returns it as the
 * `nextPreview` for the following click). Centralizing it here guarantees the
 * pre-click estimate and the post-click charge/gain can never drift: both the
 * effective PS cost (pressure ladder) AND the projected Org gain (with the same
 * priority-region bonus + pool/rival clamping the POST applies) are computed in
 * one place.
 *
 * Read-only: reads `statePartyOrg`, `politicalParties`, and
 * `partyStrengthPressure` but mutates nothing, so the POST can call it *after*
 * committing a spend to project the next click against fresh state.
 */
export interface BuildOrgPreviewFactors {
  base: number;
  headroom: number;
  ownDiminishing: number;
  psLeverage: number;
  catchup: number;
}

export type BuildOrgPreviewResult =
  | {
      ok: true;
      /** Effective PS cost of the next click (base + current pressure, capped). */
      effectiveCost: number;
      /** Current per-(party, state) pressure-ladder value. */
      pressureValue: number;
      /** Org% the next click actually grants — clamped exactly as the POST applies it. */
      projectedGain: number;
      /** Per-rival poach losses the next click would inflict (loss > 0 only). */
      poaches: {
        partyId: string;
        loss: number;
        /** Display name when the rival party doc is available. */
        partyName?: string;
        /** Short label (abbreviation) when available. */
        abbreviation?: string;
      }[];
      factors: BuildOrgPreviewFactors;
      scope: "state" | "national-targeted";
      eligibleScopes: SpenderScopeEligibility;
      priorityRegionBonusApplied: boolean;
    }
  | { ok: false; reason: "no-presence" | "auth" | "no-headroom"; message: string };

export interface ComputeBuildOrgPreviewParams {
  countryId: CountryId;
  /** Upper-cased region id. */
  upperRegionId: string;
  /** Resolved spender party doc (national tier). */
  spenderParty: PoliticalParty;
  authUser: AuthUserWithCharacter;
}

export async function computeBuildOrgPreview(
  db: Db,
  { countryId, upperRegionId, spenderParty, authUser }: ComputeBuildOrgPreviewParams
): Promise<BuildOrgPreviewResult> {
  // The spender row MAY be absent (seed deliberately omits e.g. CDU in Bayern).
  // Project from a virtual 0% row so the preview matches the POST's bootstrap —
  // read-only, no mutation. Presence (checked next) is the real gate.
  const spenderRow = await db.collection<StatePartyOrg>("statePartyOrg").findOne({
    countryId,
    stateId: upperRegionId,
    partyId: String(spenderParty.sequentialId),
  });

  // Live presence check (mirrors the POST route) rather than the cached
  // `statePartyOrg.hasPresence` flag, which only refreshes on membership events.
  const hasPresence = await checkPartyPresence(
    db,
    upperRegionId,
    String(spenderParty.sequentialId)
  );
  if (!hasPresence) {
    return {
      ok: false,
      reason: "no-presence",
      message:
        "Cannot build org without presence in this state. Establish a player or elected official here first.",
    };
  }

  if (!canSpendOnStateParty(spenderParty, spenderRow, authUser)) {
    return {
      ok: false,
      reason: "auth",
      message: "Only the party chair, vice chair, an assigned campaigner, or admin can build org",
    };
  }

  const ownId = String(spenderParty.sequentialId);
  const allStateRows = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId, stateId: upperRegionId })
    .toArray();

  const totalPartyOrgPct = allStateRows.reduce((s, r) => s + (r.organization ?? 0), 0);
  const rivalRows = allStateRows.filter((r) => r.partyId !== ownId && (r.organization ?? 0) > 0);
  const rivalLeadOrgPct = rivalRows.reduce((max, r) => Math.max(max, r.organization ?? 0), 0);

  // Resolve each rival party doc for (a) the unmanned-default shield and (b) its
  // NATIONAL PS pool, blended into the strength comparison so the projection
  // matches the POST route.
  const rivalParties = rivalRows.length
    ? await db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId, sequentialId: { $in: rivalRows.map((r) => Number(r.partyId)) } })
        .toArray()
    : [];
  const partyBySeq = new Map(rivalParties.map((p) => [String(p.sequentialId), p]));
  const shieldByPartyId = new Map<string, number>();
  for (const r of rivalRows) {
    const p = partyBySeq.get(r.partyId);
    shieldByPartyId.set(r.partyId, p ? await resolveUnmannedDefaultCaptureMultiplier(db, p) : 1);
  }

  // Effective PS = state PS + a fraction of national PS, for spender and rivals.
  const ownPS = blendedComparisonPs(
    spenderRow?.politicalStrength ?? 0,
    spenderParty.politicalStrength ?? 0
  );
  const rivals = rivalRows.map((r) => ({
    partyId: r.partyId,
    orgPct: r.organization ?? 0,
    ps: blendedComparisonPs(
      r.politicalStrength ?? 0,
      partyBySeq.get(r.partyId)?.politicalStrength ?? 0
    ),
    shield: shieldByPartyId.get(r.partyId) ?? 1,
  }));
  const rivalsWithPS = rivals.filter((r) => r.ps > 0);
  const avgRivalPS =
    rivalsWithPS.length > 0 ? rivalsWithPS.reduce((s, r) => s + r.ps, 0) / rivalsWithPS.length : 0;

  const breakdown: UnifiedBuildOrgBreakdown = calcUnifiedBuildOrg({
    ownOrgPct: spenderRow?.organization ?? 0,
    ownPS,
    totalPartyOrgPct,
    rivalLeadOrgPct,
    avgRivalPS,
    rivals,
  });

  if (breakdown.totalGain <= 0) {
    return {
      ok: false,
      reason: "no-headroom",
      message:
        "Nothing to build here — the unaffiliated pool is empty and no rival holds any Org to poach.",
    };
  }

  const scope = resolveSpenderScope(spenderParty, spenderRow, authUser);
  const eligibleScopes = resolveSpenderScopeEligibility(spenderParty, spenderRow, authUser);

  const pressureRow = await db
    .collection<PartyStrengthPressure>("partyStrengthPressure")
    .findOne({ _id: `${countryId}_${spenderParty.sequentialId}_${upperRegionId}` });
  const pressureValue = pressureRow?.value ?? 0;
  const effectiveCost = effectivePsCost(BUILD_ORG_BASE_PS_COST, pressureValue);

  // Project the gain EXACTLY as the POST applies it: priority-region bonus on the
  // effect (not the cost), then re-clamp the pool slice to the unaffiliated
  // remainder and each poach to the rival's current Org. Without this the preview
  // over-reports gain in a saturated / oversaturated state.
  const priorityBonus = isStateInPriorityRegion(spenderParty, upperRegionId)
    ? 1 + PRIORITY_REGION_EFFECT_BONUS
    : 1;
  const poolAvailablePct = Math.max(0, 100 - totalPartyOrgPct);
  const appliedPoolGain = Math.min(breakdown.poolGain * priorityBonus, poolAvailablePct);
  const rivalOrgById = new Map(rivalRows.map((r) => [r.partyId, r.organization ?? 0]));
  const appliedPoaches = breakdown.rivalPoaches
    .map((p) => {
      const rivalParty = partyBySeq.get(p.partyId);
      return {
        partyId: p.partyId,
        loss: Math.min(p.loss * priorityBonus, rivalOrgById.get(p.partyId) ?? 0),
        ...(rivalParty
          ? { partyName: rivalParty.name, abbreviation: rivalParty.abbreviation }
          : {}),
      };
    })
    .filter((p) => p.loss > 0);
  const projectedGain = appliedPoolGain + appliedPoaches.reduce((s, p) => s + p.loss, 0);

  return {
    ok: true,
    effectiveCost,
    pressureValue,
    projectedGain,
    poaches: appliedPoaches,
    factors: breakdown.factors,
    scope,
    eligibleScopes,
    priorityRegionBonusApplied: priorityBonus > 1,
  };
}
