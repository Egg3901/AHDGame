/**
 * Client-side helper to render the PersuasionDrivers card from
 * election-detail DTO data. Computes the driver breakdown between the
 * race's leader and runner-up using the engine's
 * `getPersuasionDriverBreakdown`.
 *
 * Driver coverage:
 *   - **Policy alignment**: always — candidate EP/SP positions are public.
 *   - **Candidate Support**: rendered when the DTO exposes per-candidate
 *     Support (privileged viewers only per the server-side fog-of-war
 *     in `enrichElection`). Otherwise defaults to neutral → 0 row.
 *   - **Money**: rendered when `fundsByParty` is supplied. Server-side
 *     enrichment populates this from `Campaign.spendThisTurn` per-party
 *     aggregation in general phase.
 *   - **Incumbency**: rendered when `incumbentSeatShareByParty` is
 *     supplied. Server-side enrichment populates this from the prior-
 *     cycle resolved tally on the same seat key.
 *   - **Presidential / Gubernatorial Coattails**: nominal-share "%" tilt
 *     rows (not persuasion drivers), appended only when their inputs
 *     (`presidentialCoattailPctByParty` / `gubernatorialCoattailPctByParty`)
 *     are supplied. Each carries a value only for the sitting executive's
 *     party.
 *
 * Missing inputs degrade to neutral rows so the card always shows the
 * full driver framework even when not all data is plumbed yet.
 */

import {
  getPersuasionDriverBreakdown,
  type PersuasionDriverComponent,
} from "@/lib/electionEngine/persuasionDrivers";
import { effectivePeelableFraction } from "@/lib/electionEngine/electionFormulaFactors";
import type { DistributeVotesOptions, EnrichedCandidate } from "@/lib/electionEngine/types";
import type { PersuasionDriver } from "@/lib/elections/generalViewModel";

interface PublicCandidate {
  id: string;
  characterId: string;
  party: string;
  partyColor: string;
  partyEcon: number;
  partySocial: number;
  economicPosition: number;
  socialPosition: number;
  favorability: number;
  politicalInfluence: number;
  nationalInfluence: number;
  isNPP: boolean;
  sharePct: number;
  /**
   * Per-candidate Support (0..100). Present only when the viewer is
   * privileged (admin or has a candidate in the race). Undefined for
   * opposing viewers — the driver math falls back to neutral 50 so
   * the supportDelta row reads 0pts (the fog).
   */
  support?: number;
}

export interface DriverDisplayInputs {
  /** Per-party spend-this-turn from `enrichElection`. Optional. */
  fundsByParty?: Record<string, number>;
  /** Per-party prior-cycle seat-share (0..1) from `enrichElection`. Optional. */
  incumbentSeatShareByParty?: Record<string, number>;
  /**
   * Per-state median voter — turnout-weighted average of demographic
   * leans. Shifts the policy-distance driver so centrism is judged
   * relative to the state's actual voter mood rather than abstract
   * `(0, 0)`. Undefined falls back to the original behavior.
   */
  medianVoter?: { ep: number; sp: number };
  /**
   * Per-party presidential coattail percentage tilt (e.g. { "2": +9 } for the
   * sitting President's party at high national approval). Rendered as a
   * "%"-unit row. Only the President's party carries a value. Undefined → no
   * presidential row.
   */
  presidentialCoattailPctByParty?: Record<string, number>;
  /**
   * Per-party gubernatorial coattail percentage tilt (e.g. { "2": +4.5 } for a
   * Republican governor). Rendered as a "%"-unit row. Only the governor's party
   * carries a value. Undefined → no gubernatorial row.
   */
  gubernatorialCoattailPctByParty?: Record<string, number>;
  /** Per-party nominal-share boost for parties outside government at midterms. */
  midtermOppositionBoostPctByParty?: Record<string, number>;
  /**
   * Single-winner executive own-race: the sitting executive's party and
   * approval (0..100). Switches the Incumbency row to the approval-scaled
   * directional shield/drag (matches the turn engine). Undefined → seat-share
   * fallback row.
   */
  incumbentPartyId?: string;
  incumbentApproval?: number;
  incumbentTenurePenalty?: number;
  /**
   * Single-seat legislative own-race (US Senate): sitting senator's party and
   * consecutive terms. Switches the Incumbency row to the flat decaying shield
   * (matches the turn engine). Undefined → seat-share fallback / neutral row.
   */
  legislativeIncumbentPartyId?: string;
  legislativeIncumbentTenureTerms?: number;
  /**
   * Per-party registration percentage (0..100) for the race's state, from
   * `statePartyOrg.registration`. Drives the effective-peelable-fraction
   * scaling of driver rows so the displayed "pp" values match the engine's
   * real swing (pool × transferableShare × (1 − resistance)). Missing party
   * keys / undefined fall back to the engine's no-Reg baseline (0.20).
   */
  regByParty?: Record<string, number>;
}

/**
 * Build an `EnrichedCandidate` shape from a public `CandidateDetail`.
 * Support defaults to 50 (neutral) when the DTO omits it (fog-of-war).
 * Infamy defaults to 0.
 */
function toEnriched(c: PublicCandidate): EnrichedCandidate {
  return {
    candidateId: c.id,
    characterId: c.characterId,
    characterName: "", // not needed for driver computation
    party: c.party,
    isNPP: c.isNPP,
    charEP: c.economicPosition,
    charSP: c.socialPosition,
    favorability: c.favorability,
    politicalInfluence: c.politicalInfluence,
    nationalInfluence: c.nationalInfluence,
    infamy: 0,
    partyEcon: c.partyEcon,
    partySocial: c.partySocial,
    archetypeApprovals: {},
    support: typeof c.support === "number" ? c.support : 50,
  };
}

/**
 * Resolve the default Focus/Opponent pair for a race: the popular-vote
 * leader as Focus, and the highest-share candidate of a *different* party
 * as Opponent. Returns null when there is no cross-party rival (single
 * candidate, or an all-one-party field) — the card then shows its
 * "data populating" placeholder.
 */
export function pickDefaultDriverPair(
  candidates: Pick<PublicCandidate, "id" | "party" | "sharePct">[]
): { focusId: string; opponentId: string } | null {
  if (candidates.length < 2) return null;
  const sorted = [...candidates].sort((a, b) => b.sharePct - a.sharePct);
  const focus = sorted[0];
  const opponent = sorted.find((c) => c.party !== focus.party);
  if (!opponent) return null;
  return { focusId: focus.id, opponentId: opponent.id };
}

/**
 * Compute the `PersuasionDriver` rows for an explicit Focus vs Opponent
 * pair. Positive contributions are tinted with the Focus candidate's party
 * color (the UI renders negatives as drag-red regardless). Returns [] when
 * either id is not in the candidate list.
 */
export function computePairwiseDriverDisplay(
  candidates: PublicCandidate[],
  focusId: string,
  opponentId: string,
  inputs: DriverDisplayInputs = {}
): PersuasionDriver[] {
  const focus = candidates.find((c) => c.id === focusId);
  const opponent = candidates.find((c) => c.id === opponentId);
  if (!focus || !opponent) return [];

  const enriched = candidates.map(toEnriched);

  // Marshal DTO maps into the engine's expected Map<string, number>
  // shapes. Missing inputs leave the corresponding driver to its
  // neutral (0) branch inside `getPersuasionDriverBreakdown`.
  const options: DistributeVotesOptions = {};
  if (inputs.fundsByParty && Object.keys(inputs.fundsByParty).length > 0) {
    options.fundsByParty = new Map(Object.entries(inputs.fundsByParty));
  }
  if (
    inputs.incumbentSeatShareByParty &&
    Object.keys(inputs.incumbentSeatShareByParty).length > 0
  ) {
    options.incumbentSeatShareByParty = new Map(Object.entries(inputs.incumbentSeatShareByParty));
  }
  if (inputs.medianVoter) {
    options.medianVoter = inputs.medianVoter;
  }
  if (inputs.incumbentPartyId != null) {
    options.incumbentPartyId = inputs.incumbentPartyId;
    options.incumbentApproval = inputs.incumbentApproval;
    options.incumbentTenurePenalty = inputs.incumbentTenurePenalty;
  }
  if (inputs.legislativeIncumbentPartyId != null) {
    options.legislativeIncumbentPartyId = inputs.legislativeIncumbentPartyId;
    options.legislativeIncumbentTenureTerms = inputs.legislativeIncumbentTenureTerms;
  }

  const components: PersuasionDriverComponent[] = getPersuasionDriverBreakdown(
    focus.party,
    opponent.party,
    enriched,
    options
  );

  // UI honesty: the engine never applies a driver at face value — the swing
  // it produces is `pool × transferableShare × (1 − resistance) × driver`
  // (see voteDistributionSwingFlow.ts Step 2). Scale each driver row by the
  // SAME effective peelable fraction of the OPPONENT's pool (the pool being
  // peeled toward Focus) so the displayed pp values match the real vote
  // impact instead of overstating it 5-20x. Missing Reg data falls back to
  // the engine's own no-Reg baseline (0.20). Direction matters: a positive
  // driver peels the OPPONENT's pool toward Focus; a negative driver peels
  // FOCUS's pool toward the opponent — each direction uses the peeled
  // party's own Reg entrenchment, exactly as the engine does.
  const peelFromOpponent = effectivePeelableFraction(inputs.regByParty?.[opponent.party]);
  const peelFromFocus = effectivePeelableFraction(inputs.regByParty?.[focus.party]);

  // Positive bars are tinted with the Focus candidate's party color so the
  // bar tint matches the "focused side" framing; negatives render drag-red
  // in the component regardless.
  const rows: PersuasionDriver[] = components.map((c) => ({
    label: c.label,
    contributionPct:
      c.contributionPct * (c.contributionPct >= 0 ? peelFromOpponent : peelFromFocus),
    color: focus.partyColor,
    unit: "pts" as const,
  }));

  // Presidential popularity — a nominal-share tilt (not a persuasion-driver),
  // surfaced as a distinct "%" row. Only the sitting President's party carries
  // a value; the pairwise row is the focus minus the opponent tilt.
  if (inputs.presidentialCoattailPctByParty) {
    const focusPct = inputs.presidentialCoattailPctByParty[focus.party] ?? 0;
    const oppPct = inputs.presidentialCoattailPctByParty[opponent.party] ?? 0;
    rows.push({
      label: "Presidential Popularity",
      contributionPct: focusPct - oppPct,
      color: focus.partyColor,
      unit: "%",
    });
  }

  // Gubernatorial coattail — a nominal-share tilt (not a persuasion-driver),
  // surfaced as a distinct "%" row. Only the sitting governor's party carries
  // a value; the pairwise row is the focus minus the opponent tilt.
  if (inputs.gubernatorialCoattailPctByParty) {
    const focusPct = inputs.gubernatorialCoattailPctByParty[focus.party] ?? 0;
    const oppPct = inputs.gubernatorialCoattailPctByParty[opponent.party] ?? 0;
    rows.push({
      label: "Gubernatorial Coattails",
      contributionPct: focusPct - oppPct,
      color: focus.partyColor,
      unit: "%",
    });
  }

  if (inputs.midtermOppositionBoostPctByParty) {
    const focusPct = inputs.midtermOppositionBoostPctByParty[focus.party] ?? 0;
    const oppPct = inputs.midtermOppositionBoostPctByParty[opponent.party] ?? 0;
    rows.push({
      label: "Midterm Opposition",
      contributionPct: focusPct - oppPct,
      color: focus.partyColor,
      unit: "%",
    });
  }

  return rows;
}

/**
 * Default driver display: popular-vote leader vs. top cross-party rival.
 * Thin wrapper over `pickDefaultDriverPair` + `computePairwiseDriverDisplay`
 * so existing callers keep the prior leader/runner-up behavior. Returns []
 * when there is no cross-party pair (single-candidate or all-one-party field).
 */
export function computePersuasionDriverDisplay(
  candidates: PublicCandidate[],
  inputs: DriverDisplayInputs = {}
): PersuasionDriver[] {
  const pair = pickDefaultDriverPair(candidates);
  if (!pair) return [];
  return computePairwiseDriverDisplay(candidates, pair.focusId, pair.opponentId, inputs);
}
