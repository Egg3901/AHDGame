/**
 * Pure poll calculation logic — no DB access, no side effects.
 *
 * Extracted from src/app/api/actions/poll/route.ts so the poll algorithm
 * can be unit-tested without a real database or HTTP context.
 */

import type {
  Character,
  State,
  DemographicCategory,
  StateDemographics,
  StatePartyOrg,
} from "@/lib/db/types";
import { calcAppeal, approvalScalar, MAX_APPEAL } from "@/lib/utils/demographicAppeal";
import {
  orgVoteWeight,
  regResistanceMultiplier,
} from "@/lib/electionEngine/electionFormulaFactors";
import { normalizeNPI } from "@/lib/utils/normalizeNPI";
import { infamyPenaltyMultiplier } from "@/lib/utils/infamy";
import { FPTP_SPOILER_RATE } from "@/lib/electionEngine/constants";
import { partitionMajorParties } from "@/lib/electionEngine/majorParties";
import { getMajorPartiesForRegion } from "@/lib/constants/countries";

function clampPercentStat(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** Opponent data for in-race share computation */
export interface OpponentForShare {
  candidateId: string;
  name?: string;
  economicPosition: number;
  socialPosition: number;
  favorability: number;
  politicalInfluence: number;
  party: string;
  /** Per-archetype modifiers when known (same as Character/NPP). */
  archetypeApprovals?: Record<string, number>;
  /** Character infamy (0..100); omit for NPPs (yields no penalty). */
  infamy?: number;
}

/**
 * Calculate effective favorability for a specific archetype.
 * effectiveFavorability = favorability + archetypeApproval * 0.5
 * Clamped to 0-100 range.
 */
export function calcEffectiveFavorability(
  baseFavorability: number,
  archetypeApproval: number | undefined
): number {
  const adjustment = (archetypeApproval ?? 0) * 0.5;
  return Math.max(0, Math.min(100, baseFavorability + adjustment));
}

/**
 * Compute full poll results for a character in their home state.
 *
 * **State / general races:** In-race totals use the same group-level
 * allocation and FPTP spoiler pass as `distributeVotesByGroupLevelAllocation`
 * (major parties from `getMajorPartiesForRegion(state.countryId, state.parentRegionId)`).
 *
 * **Presidential:** Simulated vote accumulation uses a per-state electoral
 * unit model with averaged party positions, national influence for reach,
 * influence in appeal, lean/ground-game adjustments, and no FPTP spoiler on
 * that path — see `src/lib/presidentialElectionEngine.ts`. Polls do not
 * replicate that; they are home-state projections only. See `docs/design/elections.md`
 * ("Polls vs simulated votes").
 */
export async function computePollData(
  character: Character,
  state: State,
  demographics: StateDemographics,
  categories: DemographicCategory[],
  statePartyOrgs?: StatePartyOrg[],
  opponents?: OpponentForShare[],
  liveTurnouts?: Record<string, number> | null,
  votingSystem?: "fptp" | "rcv"
) {
  // Age-aware electorate (P1b-1b): polls estimate the election, so they use the
  // same voting-age basis the real tally uses (tallyManagement), falling back to
  // total population on unseeded worlds. Vote SHARES are basis-invariant (F-4);
  // this keeps any absolute turnout estimate consistent with the result.
  const statePopulation = state.votingEligiblePopulation ?? state.population;
  const userEP = character.policies.economic;
  const userSP = character.policies.social;
  const favorability = character.favorability;
  // State polls should treat PI as a 0-100 stat even if legacy data drifted above
  // the cap, otherwise stale records get extra reach in home-state projections.
  const politicalInfluence = clampPercentStat(character.politicalInfluence ?? 0);
  const archetypeApprovals = character.archetypeApprovals ?? {};

  const partyOrgByParty = new Map(
    (statePartyOrgs ?? []).map((po) => [po.partyId, po.organization])
  );
  // Org enters the head-to-head share via `orgVoteWeight` (= normalized state
  // share ^ ORG_WEIGHT_EXPONENT — the same diminishing-returns curve the
  // general-election engine uses), with a neutral `1×` fallback when the state
  // has no Org data so polls don't zero out every candidate.
  //
  // NOTE: this weighting is applied ONLY to the head-to-head predicted share.
  // The standalone "potential voters" reach estimate stays Org-neutral so its
  // absolute magnitude doesn't swing with party Org (single-candidate reach
  // figure, not a competitive share).
  const partyOrg = orgVoteWeight(partyOrgByParty, character.party);

  // Reg as a baseline nominal tilt (1.0–1.3×) in the head-to-head share — same
  // factor the general-election engine applies — so the poll preview reflects
  // registration entrenchment. Neutral 1× where Reg is unset.
  const regByParty = new Map<string, number>();
  for (const po of statePartyOrgs ?? []) {
    if (typeof po.registration === "number") regByParty.set(po.partyId, po.registration);
  }
  const partyRegMult = (party: string): number => regResistanceMultiplier(regByParty.get(party));
  const partyReg = partyRegMult(character.party);

  // Filter out categories with zero weight (e.g. UK categories when in a US state)
  const activeCategories = categories.filter((c) => (demographics.categoryWeights[c._id] ?? 0) > 0);

  const results = activeCategories.map((category) => {
    const categoryWeight = demographics.categoryWeights[category._id] ?? 0;

    const groups = category.groups.map((group) => {
      const stateGroup = demographics.groups[group.id];

      const populationPct = stateGroup?.population ?? 0;
      const demoEP = stateGroup?.economicLean ?? group.defaultEconomicLean;
      const demoSP = stateGroup?.socialLean ?? group.defaultSocialLean;
      // Prefer live-computed turnout (derived from Layer-1 composition) over stale DB value
      const turnoutPct =
        liveTurnouts?.[group.id] ?? stateGroup?.turnout ?? group.defaultTurnout ?? 55;

      // Reach: political influence (name recognition) determines what fraction of turned-out voters the candidate reaches
      const reachFraction = normalizeNPI(politicalInfluence ?? 0);

      const groupPop = Math.round(statePopulation * (populationPct / 100));
      const turnoutPop = Math.round(groupPop * (turnoutPct / 100));
      const reachedPop = Math.round(turnoutPop * reachFraction);

      // Appeal (0-25): quadratic position only (state-level: NPI is reach, not appeal)
      const appeal = calcAppeal(demoEP, demoSP, userEP, userSP, politicalInfluence ?? 0, false);
      const rawPotential = Math.round(reachedPop * (appeal / MAX_APPEAL));

      // Per-archetype effective favorability: favorability + archetypeApproval * 0.5
      const archetypeApproval = archetypeApprovals[group.id] ?? 0;
      const effectiveFav = calcEffectiveFavorability(favorability, archetypeApproval);
      const effectiveApproval = approvalScalar(effectiveFav);

      // Org-neutral: the single-candidate potential-voters estimate does not
      // apply party Org (that lives in the head-to-head share only), so the
      // displayed count stays stable regardless of party organization.
      const weightedPotential = Math.round(
        rawPotential * (categoryWeight / 100) * effectiveApproval
      );

      // In-race: estimated share of this group when competing (group-level competitive allocation)
      let estimatedSharePct: number | undefined;
      if (opponents && opponents.length > 0) {
        const myInfamyMult = infamyPenaltyMultiplier(character.infamy);
        const myWeight =
          appeal * reachFraction * effectiveApproval * partyOrg * partyReg * myInfamyMult;
        let totalWeight = myWeight;
        for (const opp of opponents) {
          const oppInfluence = clampPercentStat(opp.politicalInfluence);
          const oppReach = normalizeNPI(oppInfluence);
          const oppAppeal = calcAppeal(
            demoEP,
            demoSP,
            opp.economicPosition,
            opp.socialPosition,
            oppInfluence,
            false
          );
          const oppArchetype = opp.archetypeApprovals?.[group.id] ?? 0;
          const oppEffectiveFav = calcEffectiveFavorability(opp.favorability, oppArchetype);
          const oppApproval = approvalScalar(oppEffectiveFav);
          const oppOrg = orgVoteWeight(partyOrgByParty, opp.party);
          const oppInfamyMult = infamyPenaltyMultiplier(opp.infamy);
          totalWeight += Math.max(
            0,
            oppAppeal * oppReach * oppApproval * oppOrg * partyRegMult(opp.party) * oppInfamyMult
          );
        }
        estimatedSharePct =
          totalWeight > 0
            ? Math.round((myWeight / totalWeight) * 1000) / 10
            : Math.round(1000 / (1 + opponents.length) / 10);
      }

      return {
        id: group.id,
        name: group.name,
        populationPct,
        economicLean: demoEP,
        socialLean: demoSP,
        turnoutPct,
        influencePct: Math.round((politicalInfluence ?? 0) * 10) / 10,
        groupPop,
        turnoutPop,
        reachedPop,
        appeal: Math.round(appeal * 100) / 100,
        rawPotential,
        weightedPotential,
        categoryName: category.name,
        categoryId: category._id as string,
        categoryWeight,
        // Archetype approval info for poll display
        archetypeApproval: Math.round(archetypeApproval * 10) / 10,
        effectiveFavorability: Math.round(effectiveFav * 10) / 10,
        ...(estimatedSharePct !== undefined && { estimatedSharePct }),
      };
    });

    const categoryTurnoutPop = groups.reduce((s, g) => s + g.turnoutPop, 0);
    const totalRawPotential = groups.reduce((s, g) => s + g.rawPotential, 0);
    const totalPotentialVoters = groups.reduce((s, g) => s + g.weightedPotential, 0);

    return {
      id: category._id as string,
      name: category.name,
      weight: categoryWeight,
      categoryTurnoutPop,
      totalRawPotential,
      totalPotentialVoters,
      groups,
    };
  });

  const totalEstimatedVoters = results.reduce(
    (s, c) => s + Math.round(c.categoryTurnoutPop * (c.weight / 100)),
    0
  );
  const totalPotentialVoters = results.reduce((s, c) => s + c.totalPotentialVoters, 0);

  let appealNumer = 0;
  let appealDenom = 0;
  for (const cat of results) {
    for (const grp of cat.groups) {
      const w = cat.weight * grp.populationPct;
      appealNumer += grp.appeal * w;
      appealDenom += w;
    }
  }
  const overallAppeal = appealDenom > 0 ? Math.round((appealNumer / appealDenom) * 100) / 100 : 0;

  const allGroups = results.flatMap((c) => c.groups);
  const topGroups = [...allGroups]
    .sort((a, b) => b.weightedPotential - a.weightedPotential)
    .slice(0, 5);
  const bottomGroups = [...allGroups]
    .sort((a, b) => a.weightedPotential - b.weightedPotential)
    .slice(0, 5);

  // In-race: compute vote totals using group-level competitive allocation (matches election engine)
  let inRaceVoteShare: { myVotes: number; opponentVotes: Record<string, number> } | undefined;
  if (opponents && opponents.length > 0 && totalEstimatedVoters > 0) {
    // Store base favorability and archetype approvals for per-group effective favorability
    const candidates = [
      {
        id: "me",
        ep: userEP,
        sp: userSP,
        influence: politicalInfluence,
        baseFavorability: favorability,
        archetypeApprovals,
        partyOrg,
        partyReg,
        party: character.party,
        infamyMult: infamyPenaltyMultiplier(character.infamy),
      },
      ...opponents.map((o) => ({
        id: o.candidateId,
        ep: o.economicPosition,
        sp: o.socialPosition,
        influence: clampPercentStat(o.politicalInfluence),
        baseFavorability: o.favorability,
        archetypeApprovals: o.archetypeApprovals ?? {},
        partyOrg: orgVoteWeight(partyOrgByParty, o.party),
        partyReg: partyRegMult(o.party),
        party: o.party,
        infamyMult: infamyPenaltyMultiplier(o.infamy),
      })),
    ];
    const votesByCandidate: Record<string, number> = {};
    for (const c of candidates) votesByCandidate[c.id] = 0;

    for (const category of activeCategories) {
      const categoryWeight = demographics.categoryWeights[category._id] ?? 0;
      if (categoryWeight <= 0) continue;

      for (const group of category.groups) {
        const stateGroup = demographics.groups[group.id];
        const populationPct = stateGroup?.population ?? 0;
        const demoEP = stateGroup?.economicLean ?? group.defaultEconomicLean;
        const demoSP = stateGroup?.socialLean ?? group.defaultSocialLean;
        const turnoutPct =
          liveTurnouts?.[group.id] ?? stateGroup?.turnout ?? group.defaultTurnout ?? 55;

        const groupContribution =
          statePopulation * (populationPct / 100) * (turnoutPct / 100) * (categoryWeight / 100);
        const groupShare = groupContribution / totalEstimatedVoters;
        const groupPool = totalEstimatedVoters * groupShare;

        let totalWeight = 0;
        const weights: Record<string, number> = {};
        for (const c of candidates) {
          const reach = normalizeNPI(c.influence);
          const appeal = calcAppeal(demoEP, demoSP, c.ep, c.sp, c.influence, false);
          // Use effective favorability per archetype
          const archetypeApproval = c.archetypeApprovals[group.id] ?? 0;
          const effectiveFav = calcEffectiveFavorability(c.baseFavorability, archetypeApproval);
          const effectiveApproval = approvalScalar(effectiveFav);
          const w = Math.max(
            0,
            appeal * reach * effectiveApproval * c.partyOrg * c.partyReg * c.infamyMult
          );
          weights[c.id] = w;
          totalWeight += w;
        }

        if (totalWeight > 0) {
          for (const c of candidates) {
            votesByCandidate[c.id] += groupPool * (weights[c.id] / totalWeight);
          }
        } else {
          const n = candidates.length;
          for (const c of candidates) {
            votesByCandidate[c.id] += groupPool / n;
          }
        }
      }
    }

    // ── FPTP vote-splitting (spoiler effect) ──────────────────────────────────
    // Mirror the election engine (`voteDistribution.ts`): major parties
    // come from `getMajorPartiesForRegion(countryId, parentRegionId)`.
    // In RCV states this step is skipped entirely.
    if ((votingSystem ?? "fptp") !== "rcv") {
      const majorPartySet = getMajorPartiesForRegion(state.countryId, state.parentRegionId);
      const { major: majorPartyCandidates, third: thirdPartyCandidates } = partitionMajorParties(
        candidates,
        majorPartySet,
        (c) => votesByCandidate[c.id] ?? 0
      );

      if (thirdPartyCandidates.length > 0 && majorPartyCandidates.length > 0) {
        for (const tp of thirdPartyCandidates) {
          const tpVotes = votesByCandidate[tp.id] ?? 0;
          const spoiled = tpVotes * FPTP_SPOILER_RATE;

          // Find ideologically nearest major-party candidate
          let nearest = majorPartyCandidates[0];
          let minDist = Infinity;
          for (const mp of majorPartyCandidates) {
            const dist = Math.abs(tp.ep - mp.ep) + Math.abs(tp.sp - mp.sp);
            if (dist < minDist) {
              minDist = dist;
              nearest = mp;
            }
          }

          // Draw votes from major party; cap at available (no negatives)
          const available = votesByCandidate[nearest.id] ?? 0;
          const actualSpoiled = Math.min(spoiled, available);
          votesByCandidate[nearest.id] = (votesByCandidate[nearest.id] ?? 0) - actualSpoiled;
          votesByCandidate[tp.id] = (votesByCandidate[tp.id] ?? 0) + actualSpoiled;
        }
      }
    }

    const myVotes = Math.round(votesByCandidate.me ?? 0);
    const opponentVotes: Record<string, number> = {};
    for (const o of opponents) {
      opponentVotes[o.candidateId] = Math.round(votesByCandidate[o.candidateId] ?? 0);
    }
    inRaceVoteShare = { myVotes, opponentVotes };
  }

  return {
    results,
    overallAppeal,
    totalEstimatedVoters,
    totalPotentialVoters,
    topGroups,
    bottomGroups,
    inRaceVoteShare,
  };
}
