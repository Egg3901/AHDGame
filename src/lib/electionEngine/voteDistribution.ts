/**
 * Group-level competitive vote distribution for the election engine.
 *
 * Each demographic group's share of the turn pool is split among candidates
 * by relative appeal within that group. Groups vote as blocs; higher appeal
 * with a group yields a larger share of that group's votes.
 */

import type { DemographicCategory, StateDemographics } from "@/lib/db/types";
import { calcAppeal, approvalScalar } from "@/lib/utils/demographicAppeal";
import { normalizeNPI, normalizeNationalReachPresidentialPrimary } from "@/lib/utils/normalizeNPI";
import { infamyPenaltyMultiplier } from "@/lib/utils/infamy";
import { getMajorPartiesForRegion, COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { calcEffectiveFavorability } from "./voteCalculations";
import { splitGroupPoolBySlate } from "./slateAllocation";
import {
  FPTP_SPOILER_RATE,
  NPP_GENERAL_WEIGHT_MULTIPLIER,
  PRIMARY_PARTY_FIT_WEIGHT,
  MAX_STATE_ORG_BONUS_PRIMARY,
  MAX_STATE_ORG_BONUS_GENERAL,
  stateOrgBonusFraction,
  HOME_STATE_BONUS_PRIMARY,
  HOME_STATE_BONUS_GENERAL,
  STATE_ORG_MAX_LEVEL,
  MAX_PARTY_INFLUENCE_BONUS_PRIMARY,
} from "./constants";
import {
  orgVoteWeight,
  regBaselineMultiplier,
  regResistanceMultiplier,
  supportMoodMultiplier,
  applyVoteReachFloor,
} from "./electionFormulaFactors";
import type { EnrichedCandidate, DistributeVotesOptions } from "./types";
import { normalizePartyInfluencePresidentialPrimary } from "@/lib/utils/normalizeNPI";
import { effectivePartyInfluenceForPresidentialPrimary } from "@/lib/primaryScore";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function spoilerOrgFactor(
  thirdPartyOrg: number | undefined,
  nearestMajorOrg: number | undefined
): number {
  const third = clamp(thirdPartyOrg ?? 0, 0, 100);
  const major = clamp(nearestMajorOrg ?? 0, 0, 100);
  return clamp(1 + (third - major) / 100, 0.25, 2);
}

// ─── Group-level competitive allocation (Phase 1 realism) ───────────────────
//
// Each demographic group contributes to the turn pool proportionally to its
// size. Within each group, candidates split that contribution by relative
// weight. The product is appeal, reach, approval, org, plus Reg resistance,
// seeded baseline, Support mood, NPP penalty, infamy, party-group favorability,
// regime, party-fit, state-org, home-state, and party influence as applicable.
// Groups vote as blocs.
//

export function distributeVotesByGroupLevelAllocation(
  enriched: EnrichedCandidate[],
  effectiveTurnPool: number,
  totalPool: number,
  statePopulation: number,
  demographics: StateDemographics,
  categories: DemographicCategory[],
  partyOrgByParty: Map<string, number>,
  options?: DistributeVotesOptions
): { votesPerCandidate: Record<string, number>; sharesPct: Record<string, number> } {
  const votesPerCandidate: Record<string, number> = {};
  for (const ec of enriched) votesPerCandidate[ec.candidateId] = 0;

  if (totalPool <= 0) {
    const sharesPct: Record<string, number> = {};
    const n = enriched.length;
    for (const ec of enriched) {
      sharesPct[ec.candidateId] = n > 0 ? Math.round(1000 / n / 10) : 0;
    }
    return { votesPerCandidate, sharesPct };
  }

  for (const category of categories) {
    const categoryWeight = demographics.categoryWeights[category._id] ?? 0;
    if (categoryWeight <= 0) continue;

    for (const group of category.groups) {
      const stateGroup = demographics.groups[group.id];
      const populationPct = stateGroup?.population ?? 0;
      const demoEP = stateGroup?.economicLean ?? group.defaultEconomicLean;
      const demoSP = stateGroup?.socialLean ?? group.defaultSocialLean;
      // Use live turnout from GOTV/canvassing/suppression if available, fall back to stored/default
      const turnoutPct =
        options?.liveTurnouts?.[group.id] ??
        (typeof stateGroup?.turnout === "number" ? stateGroup.turnout : group.defaultTurnout) ??
        55;

      const groupContribution =
        statePopulation * (populationPct / 100) * (turnoutPct / 100) * (categoryWeight / 100);
      const groupShare = groupContribution / totalPool;
      const groupPool = effectiveTurnPool * groupShare;

      const weights: Record<string, number> = {};

      for (const ec of enriched) {
        const rawReach = options?.useNationalInfluenceForReach
          ? ec.nationalInfluence
          : ec.politicalInfluence;
        const reach = applyVoteReachFloor(
          options?.useNationalInfluenceForReach && options?.presidentialPrimaryNationalReach
            ? normalizeNationalReachPresidentialPrimary(rawReach)
            : normalizeNPI(rawReach)
        );
        // Skip party-weighted position averaging for independents — they have no
        // coalition to pull them toward. Their raw position is all they have, and
        // they already pay INDEPENDENT_VOTE_PENALTY for going solo. Averaging toward
        // a centrist default would double-compensate.
        const useAvg =
          options?.useAveragedPositions &&
          ec.partyEcon != null &&
          ec.partySocial != null &&
          ec.party !== "independent";
        const pw = options?.partyPositionWeight ?? 1;
        const posEP = useAvg ? (pw * ec.partyEcon! + ec.charEP) / (pw + 1) : ec.charEP;
        const posSP = useAvg ? (pw * ec.partySocial! + ec.charSP) / (pw + 1) : ec.charSP;
        const influenceForAppeal = options?.useNationalInfluenceForReach
          ? ec.nationalInfluence
          : ec.politicalInfluence;
        const appeal = calcAppeal(
          demoEP,
          demoSP,
          posEP,
          posSP,
          influenceForAppeal,
          options?.includeInfluenceInAppeal ?? false,
          ec.partyEcon,
          ec.partySocial
        );
        const archetypeApproval = ec.archetypeApprovals?.[group.id] ?? 0;
        // State-scoped favourability adjustment (local attacks). Clamped into
        // the same 0..100 band favorability itself lives in, so a stacked
        // attack cannot drive a candidate negative.
        const favDelta = options?.favorabilityDeltaByCandidate?.[ec.candidateId] ?? 0;
        const stateFavorability =
          favDelta === 0 ? ec.favorability : Math.max(0, Math.min(100, ec.favorability + favDelta));
        const effectiveFav = calcEffectiveFavorability(stateFavorability, archetypeApproval);
        const approval = approvalScalar(effectiveFav);
        // General elections: Org enters via the diminishing-returns curve
        // (`orgVoteWeight` = normalized state share ^ ORG_WEIGHT_EXPONENT), which
        // softens a dominant party's Org edge while preserving order. It returns
        // neutral `1×` when the state has no Org data at all, and `0` for a party
        // with no presence in a populated state (gate preserved).
        //
        // Primaries are intra-party: every candidate shares the same Org, so a
        // uniform `1×` leaves the within-party split unchanged.
        const org = options?.isGeneralElection ? orgVoteWeight(partyOrgByParty, ec.party) : 1;
        // Phase 5a — Reg as persuasion-resistance, Support as candidate mood.
        // Both gracefully return 1.0× when undefined; consumed only in general
        // elections per the §7.3.2 formula contract.
        const regResistance = options?.isGeneralElection
          ? regResistanceMultiplier(options?.regByParty?.get(ec.party))
          : 1.0;
        // Seeded party-baseline (registrationShare): concave share^0.5 scalar
        // so a 2.5%-baseline party lands in single digits instead of the
        // twenties. Exactly 1.0× when the seeded field is absent (all
        // pre-existing worlds and every US lane) — see regBaselineMultiplier.
        const regBaseline = options?.isGeneralElection
          ? regBaselineMultiplier(options?.regShareByParty?.get(ec.party))
          : 1.0;
        const supportMood = options?.isGeneralElection ? supportMoodMultiplier(ec.support) : 1.0;
        // Apply a moderate weight penalty to NPPs when a human player is in the
        // same general election — NPPs should still be competitive but lose their
        // structural advantage over active players. See NPP_GENERAL_WEIGHT_MULTIPLIER.
        const nppPenalty = ec.isNPP && options?.hasPlayerInRace ? NPP_GENERAL_WEIGHT_MULTIPLIER : 1;
        const infamyMult = infamyPenaltyMultiplier(ec.infamy);
        // Per-party demographic favorability bonus (Address-driven). Looked
        // up by candidate's party + current voter group. Each active row's
        // delta contributes additively as a (1 + delta/100) multiplier.
        const pgfBonus = options?.partyGroupFavorabilityByKey?.get(`${ec.party}:${group.id}`) ?? 0;
        const pgfMult = 1 + pgfBonus / 100;
        // OPS regime multiplier — 1.0 (no-op) for non-OPS countries; for OPS
        // applies the ruling/approved/banned/independent weight from
        // `resolveRegimeMultiplier` (typically 3.0 / 0.375 / 0 / 0). Engine
        // defaults to 1.0 when the enriched record lacks the field (legacy
        // call sites and unit tests that construct fixtures by hand).
        const regimeMult = typeof ec.regimeMult === "number" ? ec.regimeMult : 1.0;
        // L1 — party-fit penalty (primary-only). Penalizes candidates
        // far from their party position uniformly across every group.
        // Collapses to 1.0× when party position is missing (independents
        // in non-party primaries, etc.) so the multiplier never amplifies
        // missing data into a 0× lockout. See PRIMARY_PARTY_FIT_WEIGHT
        // in ./constants.ts for the reference table — the /6 normalizer
        // matches typical within-party Manhattan spreads (Park-style
        // centrist at dist 3 → rawFit=0.5) and clamps at the
        // across-the-party-line distance (dist ≥ 6 → rawFit=0).
        let partyFit = 1;
        if (options?.applyPartyFit && ec.partyEcon != null && ec.partySocial != null) {
          const epDist = Math.abs(ec.charEP - ec.partyEcon);
          const spDist = Math.abs(ec.charSP - ec.partySocial);
          const rawFit = Math.max(0, 1 - (epDist + spDist) / 6);
          partyFit = 1 - PRIMARY_PARTY_FIT_WEIGHT * (1 - rawFit);
        }
        // Regional bases L1 — per-candidate state-org multiplier. Gated only
        // on map presence (not on applyPartyFit) so the general path can
        // populate the same map and pick its own cap via isGeneralElection.
        // Primary cap: MAX_STATE_ORG_BONUS_PRIMARY (0.25). General cap:
        // MAX_STATE_ORG_BONUS_GENERAL (0.15).
        let stateOrgMult = 1;
        if (options?.stateOrgByCandidate) {
          const level = options.stateOrgByCandidate.get(ec.candidateId) ?? 0;
          if (level > 0) {
            const maxBonus = options.isGeneralElection
              ? MAX_STATE_ORG_BONUS_GENERAL
              : MAX_STATE_ORG_BONUS_PRIMARY;
            // Unbounded level, diminishing bonus — see stateOrgBonusFraction.
            stateOrgMult = 1 + stateOrgBonusFraction(level) * maxBonus;
          }
        }
        // Regional bases C — flat home-state bump. Same decoupling: gated on
        // map presence + currentStateId, with the cap picked by path.
        let homeStateMult = 1;
        if (options?.homeStateByCandidate && options.currentStateId) {
          const home = options.homeStateByCandidate.get(ec.candidateId);
          if (home && home === options.currentStateId) {
            homeStateMult =
              1 + (options.isGeneralElection ? HOME_STATE_BONUS_GENERAL : HOME_STATE_BONUS_PRIMARY);
          }
        }
        // Party influence — presidential primary only. Uses the candidate's
        // raw accumulated party influence (no chair multiplier). Mirrors the
        // snapshot score's party-influence lever.
        let partyInfluenceMult = 1;
        if (options?.presidentialPrimaryNationalReach) {
          const effective = effectivePartyInfluenceForPresidentialPrimary(
            ec.partyInfluence ?? 0,
            ec.partyChairRole ?? null,
            {
              currentStateId: options.currentStateId,
              chairStateIds: ec.stateChairStateIds,
              countryId: options.countryId,
            }
          );
          const normalized = normalizePartyInfluencePresidentialPrimary(effective);
          partyInfluenceMult = 1 + normalized * MAX_PARTY_INFLUENCE_BONUS_PRIMARY;
        }
        // UK manifesto policy-popularity factor (epic #856). Off by default:
        // when no map is supplied the lookup falls back to 1.0 (no effect).
        const manifestoMult = options?.manifestoMultipliers?.[ec.party]?.[group.id] ?? 1;
        const w = Math.max(
          0,
          appeal *
            reach *
            approval *
            org *
            regResistance *
            regBaseline *
            supportMood *
            nppPenalty *
            infamyMult *
            pgfMult *
            regimeMult *
            partyFit *
            stateOrgMult *
            homeStateMult *
            partyInfluenceMult *
            manifestoMult
        );
        weights[ec.candidateId] = w;
      }

      // Slate-nested split (#1048), kept identical to the swing-flow engine so
      // the two lanes cannot drift. No-op for primaries (one party, so the
      // single slate takes the whole pool and the within-slate split reproduces
      // the old per-candidate split) and for one-candidate-per-party generals.
      const groupSplit = splitGroupPoolBySlate(
        groupPool,
        enriched.map((ec) => ({
          candidateId: ec.candidateId,
          party: ec.party,
          weight: weights[ec.candidateId] ?? 0,
        }))
      );
      for (const ec of enriched) {
        votesPerCandidate[ec.candidateId] += groupSplit[ec.candidateId] ?? 0;
      }
    }
  }

  // ── FPTP vote-splitting (spoiler effect) ────────────────────────────────────
  // Only applies in general elections (not primaries) in FPTP states when both
  // third-party and major-party candidates are present in the same race.
  //
  // For each third-party candidate, FPTP_SPOILER_RATE × their own group-level
  // allocation is transferred FROM the ideologically nearest major-party
  // candidate TO the third party.  This models the real-world spoiler / vote-
  // splitting dynamic: a nearby third party bleeds coalition voters from a major
  // party, potentially flipping the seat to the opposing major party.
  //
  // In RCV states this step is skipped — ranked choice eliminates the spoiler.
  // For one-party states the spoiler dynamic is also skipped: the regime
  // multiplier already encodes ruling-vs-approved dominance by an order of
  // magnitude, and a "third-party bleeds the major" reading misrepresents the
  // CN-style competitive landscape entirely.
  // Prefer the runtime override (pre-resolved from countryState by the
  // caller) so a mid-game system conversion takes effect immediately.
  // Falls back to COUNTRY_CONFIGS for hand-built test fixtures that don't
  // thread a DB through.
  const skipSpoilerForOps =
    options?.isOnePartyState ??
    (options?.countryId && COUNTRY_CONFIGS[options.countryId]?.governmentType === "onePartyState");
  if (options?.isGeneralElection && options?.votingSystem !== "rcv" && !skipSpoilerForOps) {
    const majorPartySet = getMajorPartiesForRegion(
      options?.countryId ?? "US",
      options?.parentRegionId
    );
    const thirdParties = enriched.filter((ec) => !majorPartySet.has(ec.party));
    const majorParties = enriched.filter((ec) => majorPartySet.has(ec.party));

    if (thirdParties.length > 0 && majorParties.length > 0) {
      const rate = options?.spoilerRate ?? FPTP_SPOILER_RATE;
      for (const tp of thirdParties) {
        // Find the ideologically nearest major-party candidate to draw votes from.
        let nearest = majorParties[0];
        let minDist = Infinity;
        for (const mp of majorParties) {
          const dist = Math.abs(tp.charEP - mp.charEP) + Math.abs(tp.charSP - mp.charSP);
          if (dist < minDist) {
            minDist = dist;
            nearest = mp;
          }
        }

        // Amount to spoil scales with the third party's own strength. When
        // enabled, local party organization further gates the transfer: a
        // high-org third party can disrupt a weak local major party, while a
        // low-org third party has less power to bleed a mature state machine.
        const localOrgFactor = options?.useOrgAwareSpoiler
          ? spoilerOrgFactor(partyOrgByParty.get(tp.party), partyOrgByParty.get(nearest.party))
          : 1;
        const spoiled = votesPerCandidate[tp.candidateId] * rate * localOrgFactor;

        // Draw from the major party; cap at their available votes (no negatives).
        const available = votesPerCandidate[nearest.candidateId];
        const actualSpoiled = Math.min(spoiled, available);
        votesPerCandidate[nearest.candidateId] -= actualSpoiled;
        votesPerCandidate[tp.candidateId] += actualSpoiled;
      }
    }
  }

  const sharesPct: Record<string, number> = {};
  const totalVotes = Object.values(votesPerCandidate).reduce((s, v) => s + v, 0);
  for (const ec of enriched) {
    sharesPct[ec.candidateId] =
      totalVotes > 0
        ? Math.round((votesPerCandidate[ec.candidateId] / totalVotes) * 1000) / 10
        : Math.round(1000 / enriched.length / 10);
  }

  return { votesPerCandidate, sharesPct };
}
