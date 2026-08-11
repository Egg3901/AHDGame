/**
 * Phase 5b view-model builder for the general-election shell rework.
 *
 * Pure function — takes the data the existing election-detail page already
 * loads (vote tally, candidate enrichment, statePartyOrgs, etc.) and folds
 * it into the shape consumed by:
 *  - `BattlegroundMap` (per-state margin tiers + 5 closest)
 *  - `RegistrationInfluenceCard` (per-state Reg-as-lean breakdown, with
 *    honest bootstrap-deferred fallback)
 *  - `PersuasionDrivers` (named driver contributions, derived from existing
 *    signals per Phase 5b D4 — no fabricated issue data)
 *
 * No DB. Easy to unit-test with hand-rolled fixtures.
 *
 * See plan §"Phase 5b — Tasks" 5b.1 + D2-D5.
 */

export type MarginTier = "safe" | "likely" | "lean" | "tossup";

export interface MarginInfo {
  leaderId: string;
  leaderColor: string;
  margin: number; // percentage points
  tier: MarginTier;
}

export interface RegPartyShare {
  partyId: string;
  partyAbbr: string;
  color: string;
  /** Lean / influence percentage in [0, 100]. NEVER framed as "votes" — see D3. */
  leanPct: number;
}

export interface RegBreakdown {
  /** True once Phase 1.5 / Phase 2 prereq seeds populate `StatePartyOrg.registration`. */
  bootstrapped: boolean;
  partyShares: RegPartyShare[];
  /** Non-party buckets. Undefined when not bootstrapped. */
  independent?: number;
  unregistered?: number;
}

export interface PersuasionDriver {
  /** Display label, e.g. "Policy alignment" or "Coattails". */
  label: string;
  /**
   * Signed contribution in `[-100, 100]`. Positive = pushes toward the
   * focused candidate / party; negative = pushes against. Magnitude is
   * relative within the driver list.
   */
  contributionPct: number;
  /** Hex color tint for the bar (positive driver = focused color, negative = error red, etc.). */
  color: string;
  /**
   * Display unit for the value. "pts" (default) for additive persuasion-driver
   * contributions; "%" for nominal-share tilts (e.g. gubernatorial coattail).
   */
  unit?: "pts" | "%";
}

export interface GeneralViewModelCandidate {
  id: string;
  name: string;
  color: string;
  partyAbbr: string;
}

export interface GeneralViewModelInput {
  candidates: GeneralViewModelCandidate[];
  /**
   * Per-state vote totals from `tally.stateVoteData`. The map is
   * `stateId → candidateId → votes`.
   */
  stateVoteData?: Record<string, Record<string, number>>;
  /**
   * Per-state Reg breakdown input. The view-model normalizes incoming
   * values and emits the typed `RegBreakdown` shape; missing rows are
   * flagged `bootstrapped: false` per D3.
   */
  regByState?: Record<
    string,
    {
      partyShares: { partyId: string; leanPct: number }[];
      independent?: number;
      unregistered?: number;
    }
  >;
  /**
   * Lookup of party display info (abbreviation + color) keyed by partyId.
   * Required to render Reg breakdowns; missing party falls back to a
   * neutral grey chip and "?" abbreviation.
   */
  partyDisplayById?: Record<string, { abbr: string; color: string }>;
  /**
   * Optional state-id → display-name map for the BattlegroundMap hover
   * card (Phase 7a Item 1). When omitted, hover cards fall back to the
   * raw state id as their header.
   */
  stateNameById?: Record<string, string>;
}

export interface GeneralElectionViewModel {
  candidates: GeneralViewModelCandidate[];
  marginByState: Record<string, MarginInfo>;
  regBreakdownByState: Record<string, RegBreakdown>;
  fiveClosestStates: string[];
  /** Per-state hover-card content for BattlegroundMap (Phase 7a Item 1). */
  hoverCardByState: Record<string, BattlegroundHoverCardData>;
}

/**
 * Margin-tier classification matching the popular-vote shading bands
 * already used by `PresidentialMapWithStateDetail`:
 *   - margin >= 15  → "safe"   (solid / dark)
 *   - margin >= 10  → "likely" (medium shade)
 *   - margin >= 5   → "lean"   (light)
 *   - margin <  5   → "tossup" (white-ish)
 */
export function classifyMarginTier(margin: number): MarginTier {
  if (margin >= 15) return "safe";
  if (margin >= 10) return "likely";
  if (margin >= 5) return "lean";
  return "tossup";
}

/**
 * Build the per-state margin info from raw vote data + candidate-color lookup.
 * States with fewer than two candidates having non-zero votes are skipped
 * (no margin to report).
 */
export function buildMarginByState(
  stateVoteData: Record<string, Record<string, number>>,
  candidateColorById: Map<string, string>
): Record<string, MarginInfo> {
  const out: Record<string, MarginInfo> = {};
  for (const [stateId, votesByCandidate] of Object.entries(stateVoteData)) {
    const sorted = Object.entries(votesByCandidate)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    if (sorted.length < 2) continue;
    const total = sorted.reduce((s, [, v]) => s + v, 0);
    if (total <= 0) continue;
    const [leaderId, leaderVotes] = sorted[0];
    const [, secondVotes] = sorted[1];
    const margin = ((leaderVotes - secondVotes) / total) * 100;
    out[stateId] = {
      leaderId,
      leaderColor: candidateColorById.get(leaderId) ?? "#9CA3AF",
      margin,
      tier: classifyMarginTier(margin),
    };
  }
  return out;
}

/**
 * Pick the 5 closest-margin states from the marginByState map. Used by
 * `BattlegroundMap`'s "Battleground" highlight filter — same semantic as
 * `PresidentialMapWithStateDetail`'s 5-closest selection but exposed
 * through the view-model so callers don't recompute.
 */
export function pickFiveClosestStates(marginByState: Record<string, MarginInfo>): string[] {
  return Object.entries(marginByState)
    .sort(([, a], [, b]) => a.margin - b.margin)
    .slice(0, 5)
    .map(([stateId]) => stateId);
}

/**
 * Build per-state Reg breakdowns from input. States missing from the input
 * (or with empty `partyShares`) emit `bootstrapped: false` per Phase 5b D3
 * so the UI can show an honest "data populating" placeholder.
 */
export function buildRegBreakdownByState(
  regByState: Record<
    string,
    {
      partyShares: { partyId: string; leanPct: number }[];
      independent?: number;
      unregistered?: number;
    }
  >,
  partyDisplayById: Record<string, { abbr: string; color: string }>
): Record<string, RegBreakdown> {
  const out: Record<string, RegBreakdown> = {};
  for (const [stateId, raw] of Object.entries(regByState)) {
    if (!raw.partyShares || raw.partyShares.length === 0) {
      out[stateId] = { bootstrapped: false, partyShares: [] };
      continue;
    }
    const partyShares: RegPartyShare[] = raw.partyShares.map((p) => {
      const display = partyDisplayById[p.partyId];
      return {
        partyId: p.partyId,
        partyAbbr: display?.abbr ?? "?",
        color: display?.color ?? "#9CA3AF",
        leanPct: Math.max(0, Math.min(100, p.leanPct)),
      };
    });
    out[stateId] = {
      bootstrapped: true,
      partyShares: partyShares.sort((a, b) => b.leanPct - a.leanPct),
      independent: raw.independent,
      unregistered: raw.unregistered,
    };
  }
  return out;
}

/** Per-state hover-card content for the BattlegroundMap. Phase 7a Item 1.
 *  Top-2 candidates always; top-3 only when 3rd has ≥ 5% share. */
export interface BattlegroundHoverCardData {
  stateName: string;
  candidates: Array<{
    name: string;
    partyAbbr: string;
    partyColor: string;
    votePct: number;
  }>;
  marginPp: number;
  tier: MarginTier;
}

const HOVER_CARD_NPP_THRESHOLD_PCT = 5;
const HOVER_CARD_FALLBACK_COLOR = "#9CA3AF";

/**
 * Build per-state hover-card content for the Battleground map. Pure function
 * — no DB. Skips states with fewer than 2 non-zero candidates (no margin to
 * show). Top-N selection: top-2 always, top-3 when 3rd ≥ 5% share.
 *
 * Used by `BattlegroundMap` to populate the `tooltipNode` field on
 * `USAMapPaths`'s `StateMapData`, replacing the plain string tooltip with a
 * structured per-candidate breakdown card.
 */
export function buildBattlegroundHoverCards(
  input: GeneralViewModelInput & { stateNameById?: Record<string, string> }
): Record<string, BattlegroundHoverCardData> {
  const stateVoteData = input.stateVoteData ?? {};
  const stateNameById = input.stateNameById ?? {};
  const candidateById = new Map(input.candidates.map((c) => [c.id, c]));

  const out: Record<string, BattlegroundHoverCardData> = {};
  for (const [stateId, votesByCandidate] of Object.entries(stateVoteData)) {
    const sorted = Object.entries(votesByCandidate)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    if (sorted.length < 2) continue;

    const total = sorted.reduce((s, [, v]) => s + v, 0);
    if (total <= 0) continue;

    // Top-2 always, top-3 only when 3rd has >= threshold share.
    const ranked = sorted.slice(0, 3);
    const top2: Array<[string, number]> = [ranked[0], ranked[1]];
    const includeThird =
      ranked.length >= 3 && (ranked[2][1] / total) * 100 >= HOVER_CARD_NPP_THRESHOLD_PCT;
    const visible = includeThird ? [...top2, ranked[2]] : top2;

    const candidates = visible.map(([candidateId, votes]) => {
      const c = candidateById.get(candidateId);
      return {
        name: c?.name ?? "?",
        partyAbbr: c?.partyAbbr ?? "?",
        partyColor: c?.color ?? HOVER_CARD_FALLBACK_COLOR,
        votePct: (votes / total) * 100,
      };
    });

    const marginPp = ((top2[0][1] - top2[1][1]) / total) * 100;

    out[stateId] = {
      stateName: stateNameById[stateId] ?? stateId,
      candidates,
      marginPp,
      tier: classifyMarginTier(marginPp),
    };
  }
  return out;
}

/**
 * Top-level builder. Composes the per-state margin / Reg / driver shapes
 * into the view-model consumed by the Phase 5b shell components.
 */
export function buildGeneralElectionViewModel(
  input: GeneralViewModelInput
): GeneralElectionViewModel {
  const candidateColorById = new Map(input.candidates.map((c) => [c.id, c.color]));
  const marginByState = input.stateVoteData
    ? buildMarginByState(input.stateVoteData, candidateColorById)
    : {};
  const fiveClosestStates = pickFiveClosestStates(marginByState);
  const regBreakdownByState = input.regByState
    ? buildRegBreakdownByState(input.regByState, input.partyDisplayById ?? {})
    : {};
  const hoverCardByState = buildBattlegroundHoverCards(input);
  return {
    candidates: input.candidates,
    marginByState,
    regBreakdownByState,
    fiveClosestStates,
    hoverCardByState,
  };
}
