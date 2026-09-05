/**
 * How general election votes are split between candidates. distributeVotesBySwingFlow
 * gives each party a nominal share from organization, turnout and the sitting
 * executive's coattail, then moves persuadable voters between parties by candidate
 * appeal. A candidate's state political influence enters through normalizeNPI,
 * which maps 0..100 influence to a 0..1 multiplier on a square-root curve
 * (25 gives 0.5, 50 gives 0.71, 100 gives 1).
 */
/**
 * §7.3.2 swing-flow vote distribution for general elections.
 *
 * Parallel implementation to `distributeVotesByGroupLevelAllocation` —
 * the existing weight-multiplier engine — implementing the two-phase
 * pairwise swing-flow model from
 * `docs/design/political-system-reg-support.md` §7.3.2:
 *
 *   nominal_share(P_i) = Org × turnoutBaseline × govModifier × candidate_support_factor
 *
 *   swing(P_i → P_j) = transferable_share(P_i.Reg%)
 *                      × persuasion_drivers(P_j vs P_i)
 *                      × (1 − persuasionResistance(P_i.Reg%))
 *
 *   final_share(P_i) = nominal_share(P_i)
 *                      − Σ_j swing(P_i → P_j)
 *                      + Σ_j swing(P_j → P_i)
 *
 * Persuasion drivers live in `persuasionDrivers.ts`. Transferable-share
 * and persuasionResistance curves are calibrated in `electionFormulaFactors.ts`.
 *
 * `govModifier` is the sitting regional executive's down-ballot coattail,
 * supplied per-party via `options.govModifierByParty` (neutral 1.0× when
 * absent). See `govCoattail.ts` for how it is built and gated.
 *
 * See `docs/plans/archive/2026-05/2026-05-21-swing-flow-implementation.md`.
 */

import type { DemographicCategory, StateDemographics } from "@/lib/db/types";
import { calcAppeal, approvalScalar } from "@/lib/utils/demographicAppeal";
import { normalizeNPI, normalizeNationalReachPresidentialPrimary } from "@/lib/utils/normalizeNPI";
import { infamyPenaltyMultiplier } from "@/lib/utils/infamy";
import { getMajorPartiesForRegion } from "@/lib/constants/countries";
import { calcEffectiveFavorability } from "./voteCalculations";
import { splitGroupPoolBySlate } from "./slateAllocation";
import {
  FPTP_SPOILER_RATE,
  NPP_GENERAL_WEIGHT_MULTIPLIER,
  MAX_STATE_ORG_BONUS_GENERAL,
  MAX_STATE_ORG_BONUS_PRIMARY,
  HOME_STATE_BONUS_GENERAL,
  HOME_STATE_BONUS_PRIMARY,
  stateOrgBonusFraction,
} from "./constants";
import {
  legislativeTenureTermsHeld,
  orgVoteWeight,
  personalOrgFloor,
  personalStatTenureRetention,
  regBaselineMultiplier,
  regResistanceMultiplier,
  supportMoodMultiplier,
  effectivePeelableFraction,
  applyVoteReachFloor,
} from "./electionFormulaFactors";
import { persuasionDrivers } from "./persuasionDrivers";
import type { EnrichedCandidate, DistributeVotesOptions, AppealWeightTrace } from "./types";

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

/**
 * Per-candidate within-group weight for the §7.3.2 nominal_share line:
 * appeal, reach, approval, org, plus NPP/infamy/PGF/regime/coattail/
 * midterm/state-org/home-state and the Reg baseline/resistance tilts.
 * Support mood is applied after this kernel; persuasion drivers belong
 * to the swing step, not this product.
 */
function appealWeight(
  ec: EnrichedCandidate,
  demoEP: number,
  demoSP: number,
  partyOrgByParty: Map<string, number>,
  groupId: string,
  options: DistributeVotesOptions | undefined,
  trace?: AppealWeightTrace
): number {
  // Personal-stat tenure erosion (see `personalStatTenureRetention`'s doc
  // comment in electionFormulaFactors.ts for the full root-cause writeup).
  // politicalInfluence / favorability have no tenure-aware decay of their
  // own — unlike the swing-side incumbency driver (which already erodes via
  // the economic referendum channel), a multi-term incumbent's reach/approval
  // edge from these two stats never shrinks on its own. This scales that
  // same per-term erosion onto the raw stat values feeding
  // reach/appeal/approval below, gated on tenure data that only exists for
  // tracked incumbencies: US President and US Senate (single scalar
  // party+terms — one seat, one incumbent) and US House (a per-candidate map,
  // since a multi-seat race can have several simultaneous incumbents — see
  // `resolveHouseIncumbentTenures`'s doc comment in singleSeatIncumbency.ts).
  // No tenure data (open seat, first term, fresh nominee, or an untracked race
  // family) ⇒ 1.0 ⇒ complete no-op. It is a FRACTION of the stat, never a
  // points charge against it, so no tenure however long can zero a candidate.
  const isTenuredExecutiveIncumbent =
    options?.incumbentPartyId != null && ec.party === options.incumbentPartyId;
  const isTenuredLegislativeIncumbent =
    options?.legislativeIncumbentPartyId != null &&
    ec.party === options.legislativeIncumbentPartyId;
  const houseIncumbentTerms = options?.houseIncumbentTenureTermsByCandidateId?.get(ec.candidateId);
  // The Senate lane reports the term being SOUGHT where the other two report
  // terms already HELD; `legislativeTenureTermsHeld` reconciles them so
  // identical service earns identical erosion in every lane. See its doc
  // comment in electionFormulaFactors.ts.
  const legislativeTermsHeld = legislativeTenureTermsHeld(options?.legislativeIncumbentTenureTerms);
  const tenureRetention = isTenuredExecutiveIncumbent
    ? personalStatTenureRetention(options?.incumbentConsecutiveTerms)
    : isTenuredLegislativeIncumbent
      ? personalStatTenureRetention(legislativeTermsHeld)
      : houseIncumbentTerms != null
        ? personalStatTenureRetention(houseIncumbentTerms)
        : 1;

  const rawReachSource = options?.useNationalInfluenceForReach
    ? ec.nationalInfluence
    : ec.politicalInfluence;
  const rawReach = Math.max(0, rawReachSource * tenureRetention);
  const reach = applyVoteReachFloor(
    options?.useNationalInfluenceForReach && options?.presidentialPrimaryNationalReach
      ? normalizeNationalReachPresidentialPrimary(rawReach)
      : normalizeNPI(rawReach)
  );

  const useAvg =
    options?.useAveragedPositions &&
    ec.partyEcon != null &&
    ec.partySocial != null &&
    ec.party !== "independent";
  const pw = options?.partyPositionWeight ?? 1;
  const posEP = useAvg ? (pw * ec.partyEcon! + ec.charEP) / (pw + 1) : ec.charEP;
  const posSP = useAvg ? (pw * ec.partySocial! + ec.charSP) / (pw + 1) : ec.charSP;
  // Same fatigued value as `rawReach` above — appeal's optional influence
  // term (`includeInfluenceInAppeal`) and reach read the same underlying
  // PI/NI stat, so both must be fatigued together or a tenured incumbent
  // could dodge the erosion through whichever term a race happens to use.
  const influenceForAppeal = rawReach;
  const appeal = calcAppeal(
    demoEP,
    demoSP,
    posEP,
    posSP,
    influenceForAppeal,
    options?.includeInfluenceInAppeal ?? false,
    // L2 party-sign gate — party positions suppress the directional bonus on
    // an axis where a leaning candidate disagrees in sign with their party.
    // Mirrors the legacy general path (voteDistribution.ts); undefined for
    // independents / unenriched fixtures → gate no-ops.
    ec.partyEcon,
    ec.partySocial
  );

  const archetypeApproval = ec.archetypeApprovals?.[groupId] ?? 0;
  const effectiveFav = calcEffectiveFavorability(
    Math.max(0, ec.favorability * tenureRetention),
    archetypeApproval
  );
  const approval = approvalScalar(effectiveFav);

  // Org via the diminishing-returns curve (`orgVoteWeight` = normalized state
  // share ^ ORG_WEIGHT_EXPONENT), softening a dominant party's Org edge. No Org
  // data anywhere → neutral 1× rather than zeroing everyone (the personal-reach
  // floor below still applies on top).
  let org = orgVoteWeight(partyOrgByParty, ec.party);

  // §7.3.2 — personal-reach floor (#0671). A candidate's own pull (reach ×
  // approval) gives a small floor on effective org, so a genuinely-supported
  // candidate is never zeroed by 0 party organisation. No-op when the party's
  // org share already exceeds the floor, and when regimeMult is 0 the banned
  // candidate is still zeroed downstream.
  org = Math.max(org, personalOrgFloor(reach, approval));

  const nppPenalty = ec.isNPP && options?.hasPlayerInRace ? NPP_GENERAL_WEIGHT_MULTIPLIER : 1;
  const infamyMult = infamyPenaltyMultiplier(ec.infamy);
  const pgfBonus = options?.partyGroupFavorabilityByKey?.get(`${ec.party}:${groupId}`) ?? 0;
  const pgfMult = 1 + pgfBonus / 100;
  // OPS regime multiplier — 1.0 (no-op) for non-OPS countries; for OPS
  // applies the ruling/approved/banned/independent weight from
  // `resolveRegimeMultiplier` (typically 3.0 / 0.375 / 0 / 0). Engine
  // defaults to 1.0 when the enriched record lacks the field (legacy
  // call sites and unit tests that construct fixtures by hand). Applied
  // inside `appealWeight` so the swing-flow nominal-share computation
  // already reflects regime dominance; downstream swings then operate
  // on an already-imbalanced per-party pool.
  const regimeMult = typeof ec.regimeMult === "number" ? ec.regimeMult : 1.0;

  // §7.3.2 govModifier — sitting regional executive's down-ballot coattail.
  // Only the executive's party carries an entry; everyone else is neutral 1.0×.
  const govMod = options?.govModifierByParty?.get(ec.party) ?? 1;

  // Presidential coattail — sitting President's party gets an approval-driven
  // nominal-share nudge nationwide. Same shape as govMod; they stack.
  const presMod = options?.presidentialModifierByParty?.get(ec.party) ?? 1;

  // Off-cycle opposition counterweight. Eligible parties receive a fixed,
  // modest nominal-share bump; governing and coalition parties stay neutral.
  const midtermOppositionMod = options?.midtermOppositionModifierByParty?.get(ec.party) ?? 1;

  // Reg as a baseline nominal-share tilt (1.0–1.3×) — entrenched registration
  // helps a party hold its vote even without active persuasion pressure, on top
  // of the swing-layer's persuasion-resistance. Neutral 1.0× when Reg is absent.
  const regResist = regResistanceMultiplier(options?.regByParty?.get(ec.party));

  // Seeded party-baseline (registrationShare): concave share^0.5 scalar so a
  // 2.5%-baseline party lands in single digits instead of the twenties.
  // Exactly 1.0× when the seeded field is absent (all pre-existing worlds and
  // every US lane) — see regBaselineMultiplier's compatibility contract.
  const regBaseline = regBaselineMultiplier(options?.regShareByParty?.get(ec.party));

  // Regional bases L1 — per-candidate state-org multiplier, ported from the
  // legacy general path (voteDistribution.ts). Gated only on map presence;
  // the cap is picked by path (swing-flow is general-only in practice, but
  // the isGeneralElection switch keeps the caps identical to legacy).
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

  // Regional bases C — flat home-state bump, same caps and gating as legacy
  // (map presence + currentStateId).
  let homeStateMult = 1;
  if (options?.homeStateByCandidate && options.currentStateId) {
    const home = options.homeStateByCandidate.get(ec.candidateId);
    if (home && home === options.currentStateId) {
      homeStateMult =
        1 + (options.isGeneralElection ? HOME_STATE_BONUS_GENERAL : HOME_STATE_BONUS_PRIMARY);
    }
  }

  // UK manifesto policy-popularity factor (epic #856). Off by default: absent
  // map ⇒ 1.0 (no effect). Mirrors the group-level engine so the two lanes
  // cannot drift.
  const manifestoMult = options?.manifestoMultipliers?.[ec.party]?.[groupId] ?? 1;

  // Ledger decomposition (display-only): reach and candidate-fit (appeal) are
  // teed out individually; every remaining structural multiplicand folds into
  // `restMult`. This is recorded ALONGSIDE the unchanged return expression
  // below — the return keeps its exact original left-to-right multiplication
  // order so vote math stays byte-identical; the sink derives a self-consistent
  // per-cell base from `reachMult * fitMult * restMult`, never from the return.
  if (trace) {
    trace.reachMult = reach;
    trace.fitMult = appeal;
    trace.restMult =
      approval *
      org *
      nppPenalty *
      infamyMult *
      pgfMult *
      regimeMult *
      govMod *
      presMod *
      midtermOppositionMod *
      regResist *
      regBaseline *
      stateOrgMult *
      homeStateMult *
      manifestoMult;
  }

  return Math.max(
    0,
    appeal *
      reach *
      approval *
      org *
      nppPenalty *
      infamyMult *
      pgfMult *
      regimeMult *
      govMod *
      presMod *
      midtermOppositionMod *
      regResist *
      regBaseline *
      stateOrgMult *
      homeStateMult *
      manifestoMult
  );
}

/**
 * §7.3.2 swing-flow distribution. Drop-in replacement for
 * `distributeVotesByGroupLevelAllocation` when
 * `options.isGeneralElection === true`. Primaries still use the legacy
 * engine — `primaryResolution.ts` has its own formula.
 */
export function distributeVotesBySwingFlow(
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

  // Factor-ledger tee. `sink` stays undefined for every non-presidential caller
  // (and whenever no unit id is supplied), so the recording branches below are a
  // complete no-op and the vote math is untouched.
  const sink = options?.ledgerSink;
  const sinkUnitId = options?.ledgerUnitId;

  if (totalPool <= 0) {
    const sharesPct: Record<string, number> = {};
    const n = enriched.length;
    for (const ec of enriched) {
      sharesPct[ec.candidateId] = n > 0 ? Math.round(1000 / n / 10) : 0;
    }
    return { votesPerCandidate, sharesPct };
  }

  // ── Step 1: per-group, per-candidate appeal weights ────────────────────
  // Capture two views: aggregated per-PARTY nominal share (for state-level
  // swing computation) and per-CANDIDATE within-party share (for the final
  // re-distribution back to candidates).
  const candidateGroupVotes: Record<string, number> = {};
  for (const ec of enriched) candidateGroupVotes[ec.candidateId] = 0;

  // Per-party total appeal-weighted votes summed across all groups.
  const partyAppealVotes = new Map<string, number>();

  for (const category of categories) {
    const categoryWeight = demographics.categoryWeights[category._id] ?? 0;
    if (categoryWeight <= 0) continue;

    for (const group of category.groups) {
      const stateGroup = demographics.groups[group.id];
      const populationPct = stateGroup?.population ?? 0;
      const demoEP = stateGroup?.economicLean ?? group.defaultEconomicLean;
      const demoSP = stateGroup?.socialLean ?? group.defaultSocialLean;
      const turnoutPct =
        options?.liveTurnouts?.[group.id] ??
        (typeof stateGroup?.turnout === "number" ? stateGroup.turnout : group.defaultTurnout) ??
        55;

      const groupContribution =
        statePopulation * (populationPct / 100) * (turnoutPct / 100) * (categoryWeight / 100);
      const groupShare = groupContribution / totalPool;
      const groupPool = effectiveTurnPool * groupShare;

      // Slate-nested split (#1048): the group pool is divided between PARTIES
      // (slate weight = mean of its candidates' appeal weights), then within a
      // party between its own candidates. Byte-identical for the
      // one-candidate-per-party FPTP families; stops a multi-seat party from
      // buying nominal share with extra ballot slots. See slateAllocation.ts.
      //
      // The ledger sink (when present) captures the trace multiplicands here so
      // it can decompose each cell's nominal votes. `appealWeight`'s return —
      // the actual slate weight — is unchanged whether or not a trace is passed.
      const traces = sink ? new Map<string, AppealWeightTrace>() : undefined;
      const groupSplit = splitGroupPoolBySlate(
        groupPool,
        enriched.map((ec) => {
          const trace: AppealWeightTrace | undefined = traces
            ? { reachMult: 1, fitMult: 1, restMult: 1 }
            : undefined;
          const weight = appealWeight(
            ec,
            demoEP,
            demoSP,
            partyOrgByParty,
            group.id,
            options,
            trace
          );
          if (traces && trace) traces.set(ec.candidateId, trace);
          return { candidateId: ec.candidateId, party: ec.party, weight };
        })
      );
      for (const ec of enriched) {
        candidateGroupVotes[ec.candidateId] += groupSplit[ec.candidateId] ?? 0;
      }

      if (sink && sinkUnitId) {
        const bucketWeights = options?.ledgerBucketWeightsByGroup?.get(group.id);
        for (const ec of enriched) {
          const v = groupSplit[ec.candidateId] ?? 0;
          const t = traces?.get(ec.candidateId);
          const product = t ? t.reachMult * t.fitMult * t.restMult : 0;
          let base = v;
          let reachDelta = 0;
          let fitDelta = 0;
          let restDelta = 0;
          if (t && v > 0 && product > 0) {
            // Decompose fit BEFORE reach so candidate-fit's effective multiplier
            // is the pure appeal term (influence-free), and reach carries the
            // name-recognition term. Keeps the reach-not-fit attribution honest.
            base = v / product;
            const afterFit = base * t.fitMult;
            const afterReach = afterFit * t.reachMult;
            fitDelta = afterFit - base;
            reachDelta = afterReach - afterFit;
            restDelta = v - afterReach;
          }
          sink.recordCellAppeal(
            sinkUnitId,
            ec.candidateId,
            v,
            demoEP,
            demoSP,
            { base, reachDelta, fitDelta, restDelta },
            bucketWeights
          );
        }
      }
    }
  }

  // ── Step 1b: Apply Support to nominal_share ────────────────────────────
  // Per §7.3.2, candidate_support_factor multiplies on the nominal_share
  // line (not on swings). FPTP families have one candidate per party so
  // the factor is just the candidate's Support multiplier; for proportional
  // families with multiple candidates per party, the per-candidate factor
  // applies before aggregation so individual mood differences carry through
  // to the within-party redistribution at Step 4.
  for (const ec of enriched) {
    candidateGroupVotes[ec.candidateId] *= supportMoodMultiplier(ec.support);
  }

  // Aggregate to party totals.
  for (const ec of enriched) {
    partyAppealVotes.set(
      ec.party,
      (partyAppealVotes.get(ec.party) ?? 0) + candidateGroupVotes[ec.candidateId]
    );
  }

  const partyIds = [...partyAppealVotes.keys()];

  // ── Step 2: state-level swing flows between parties ────────────────────
  // For each ordered pair (P_i, P_j) with i ≠ j, swing flow from P_i to P_j
  // is the share of P_i's vote that P_j can peel given the persuasion
  // drivers favouring P_j and Reg-based resistance on P_i.
  const regByParty = options?.regByParty;
  const swingFromTo = new Map<string, Map<string, number>>();
  for (const pi of partyIds) {
    const piMap = new Map<string, number>();
    swingFromTo.set(pi, piMap);

    const piReg = regByParty?.get(pi);
    const piPool = partyAppealVotes.get(pi) ?? 0;
    const peelableFraction = effectivePeelableFraction(piReg);

    for (const pj of partyIds) {
      if (pj === pi) continue;
      const driver = persuasionDrivers(pj, pi, enriched, options);
      // Driver bound [-1, +1]; we only consume the positive portion as a
      // peel from pi → pj. Negative drivers (pj is less persuasive than pi)
      // simply mean no swing in this direction (they'd produce a non-physical
      // negative flow if we let them through).
      const positiveDriver = Math.max(0, driver);
      piMap.set(pj, piPool * peelableFraction * positiveDriver);
    }

    // Vote conservation — each pairwise peel above is computed independently,
    // so with N positive-driver opponents the summed outflow could exceed the
    // peelable pool (peelableFraction × piPool), minting votes once recipients
    // kept full inflow while the donor clamped at 0. Proportionally rescale so
    // Σ(outflows) ≤ peelableFraction × piPool. Single-opponent races are
    // unaffected (driver ≤ 1 keeps them under the cap already).
    let totalOutflow = 0;
    for (const v of piMap.values()) totalOutflow += v;
    const maxOutflow = piPool * peelableFraction;
    if (totalOutflow > maxOutflow && totalOutflow > 0) {
      const scale = maxOutflow / totalOutflow;
      for (const [pj, v] of piMap) piMap.set(pj, v * scale);
    }
  }

  // ── Step 3: final_share per party ──────────────────────────────────────
  const partyFinalVotes = new Map<string, number>();
  for (const pi of partyIds) {
    const nominal = partyAppealVotes.get(pi) ?? 0;
    let outflow = 0;
    let inflow = 0;
    const outMap = swingFromTo.get(pi);
    if (outMap) {
      for (const v of outMap.values()) outflow += v;
    }
    for (const pj of partyIds) {
      if (pj === pi) continue;
      const inFromPj = swingFromTo.get(pj)?.get(pi) ?? 0;
      inflow += inFromPj;
    }
    partyFinalVotes.set(pi, Math.max(0, nominal - outflow + inflow));
  }

  // ── Step 4: re-distribute party totals back to candidates ──────────────
  // Within each party, candidates keep their pre-swing share of the
  // party's appeal-weighted votes. Single-candidate FPTP families: this is
  // a no-op (one candidate gets the full party total). Multi-candidate
  // proportional families: per-candidate Support / archetype variation
  // still influences the within-party split.
  for (const ec of enriched) {
    const partyNominal = partyAppealVotes.get(ec.party) ?? 0;
    const partyFinal = partyFinalVotes.get(ec.party) ?? 0;
    const withinPartyShare =
      partyNominal > 0 ? candidateGroupVotes[ec.candidateId] / partyNominal : 0;
    votesPerCandidate[ec.candidateId] = partyFinal * withinPartyShare;
  }

  // ── Step 5: FPTP spoiler ───────────────────────────────────────────────
  // Same logic as the legacy engine — applied after swing-flow to the
  // per-candidate votes. Spoiler is structurally orthogonal to the
  // peel-vs-resistance mechanic (it models within-coalition leakage, not
  // cross-coalition persuasion), so it stays as a post-step.
  if (options?.votingSystem !== "rcv") {
    const majorPartySet = getMajorPartiesForRegion(
      options?.countryId ?? "US",
      options?.parentRegionId
    );
    const thirdParties = enriched.filter((ec) => !majorPartySet.has(ec.party));
    const majorParties = enriched.filter((ec) => majorPartySet.has(ec.party));

    if (thirdParties.length > 0 && majorParties.length > 0) {
      const rate = options?.spoilerRate ?? FPTP_SPOILER_RATE;
      for (const tp of thirdParties) {
        let nearest = majorParties[0];
        let minDist = Infinity;
        for (const mp of majorParties) {
          const dist = Math.abs(tp.charEP - mp.charEP) + Math.abs(tp.charSP - mp.charSP);
          if (dist < minDist) {
            minDist = dist;
            nearest = mp;
          }
        }

        const localOrgFactor = options?.useOrgAwareSpoiler
          ? spoilerOrgFactor(partyOrgByParty.get(tp.party), partyOrgByParty.get(nearest.party))
          : 1;
        const spoiled = votesPerCandidate[tp.candidateId] * rate * localOrgFactor;
        const available = votesPerCandidate[nearest.candidateId];
        const actualSpoiled = Math.min(spoiled, available);
        votesPerCandidate[nearest.candidateId] -= actualSpoiled;
        votesPerCandidate[tp.candidateId] += actualSpoiled;
      }
    }
  }

  // Ledger tee (close-out): record support plus the swing and spoiler deltas
  // the engine has already computed. `swingDelta` is the party-level flow this
  // candidate's within-party share carried; `spoilerDelta` is the post-swing
  // FPTP transfer. Both are the exact locals above — nothing is recomputed.
  if (sink && sinkUnitId) {
    for (const ec of enriched) {
      const partyNominal = partyAppealVotes.get(ec.party) ?? 0;
      const partyFinal = partyFinalVotes.get(ec.party) ?? 0;
      const withinPartyShare =
        partyNominal > 0 ? candidateGroupVotes[ec.candidateId] / partyNominal : 0;
      const preSpoiler = partyFinal * withinPartyShare;
      sink.finalizeUnitCandidate(sinkUnitId, ec.candidateId, {
        support: supportMoodMultiplier(ec.support),
        swingDelta: preSpoiler - candidateGroupVotes[ec.candidateId],
        spoilerDelta: (votesPerCandidate[ec.candidateId] ?? 0) - preSpoiler,
      });
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
