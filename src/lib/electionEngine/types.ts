/**
 * Shared types and interfaces for the election engine sub-modules.
 */

import type {
  DemographicCategory,
  State,
  StateDemographics,
  StateDemographicTurnout,
  StateRegistrationPool,
} from "@/lib/db/types";
import type { StatePartyOrg } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

export interface EnrichedCandidate {
  candidateId: string; // ElectionCandidate._id
  characterId: string;
  characterName: string;
  party: string;
  /**
   * Party abbreviation (SNP, LAB, CON, …) when the enrichment pass loaded
   * politicalParties. Used to hard-block UK regional parties outside their
   * home nation (ticket #1110). Optional so hand-built fixtures stay valid.
   */
  partyAbbr?: string;
  isNPP: boolean;
  charEP: number;
  charSP: number;
  favorability: number;
  politicalInfluence: number; // state-level name recognition (reach for state elections)
  nationalInfluence: number; // national name recognition (reach for presidential elections)
  /**
   * Candidate's own accumulated party clout (`character.partyInfluence`, ~0–150).
   * Used as a presidential-primary vote-weight differentiator (intra-party).
   * NPPs have no partyInfluence and leave this undefined / 0.
   */
  partyInfluence?: number;
  /**
   * National vs state party-chair role for the presidential-primary influence
   * boost. National → +25% everywhere; state → +15% in chair state + adjacent.
   */
  partyChairRole?: "national" | "state" | null;
  /** State id(s) this candidate chairs (state-party org). Used with state role. */
  stateChairStateIds?: string[];
  /**
   * Character infamy (0..100). NPPs do not have infamy and leave this undefined,
   * yielding no penalty (multiplier 1.0) in vote distribution.
   */
  infamy?: number;
  /** When present, appeal uses average of party and candidate positions */
  partyEcon?: number;
  partySocial?: number;
  /** Per-bucket approval modifiers (-100 to +100) for effective favorability — see `Character.archetypeApprovals`. */
  archetypeApprovals?: Record<string, number>;
  /**
   * Per-candidate Support — short-term mood / momentum, 0..100. Phase 0.5
   * §3.1 canonical store: `electionCandidates.support`. Phase 5a consumes
   * this in general-election allocation via `supportMoodMultiplier`.
   * Undefined / NaN degrades gracefully to neutral 1.0× (no penalty).
   */
  support?: number;
  /**
   * Party regime status for OPS countries. Carried through from
   * `politicalParties.regimeStatus`. Undefined when the country is not
   * a one-party state OR when the candidate has no party (independent).
   */
  regimeStatus?: "ruling" | "approved" | "banned" | null;
  /**
   * Per-candidate vote-weight multiplier resolved from country
   * `governmentType` + party `regimeStatus` via `resolveRegimeMultiplier`.
   * Always 1.0 for non-OPS countries. Multiplies into the per-candidate
   * weight in `voteDistribution.distributeVotesByGroupLevelAllocation`.
   *
   * Optional for forward-compatibility — consumers that build fixtures
   * by hand may omit it, and the engine treats `undefined` as `1.0`.
   * `fetchEnrichedCandidates` always sets it for live data.
   */
  regimeMult?: number;
}

export interface DistributeVotesOptions {
  /**
   * Points to add to a candidate's favourability FOR THIS STATE ONLY, keyed by
   * candidateId. Negative for a local attack.
   *
   * Applied before the approval curve, so the hit lands through each group's
   * approval rather than as a flat slice off the count. That is what separates
   * a local attack from vote suppression: its bite depends on the state's
   * composition, and a candidate the state already likes shrugs off more of it.
   *
   * Absent → no adjustment, which is every caller that has not opted in.
   */
  favorabilityDeltaByCandidate?: Record<string, number>;
  /** Use averaged (party + candidate) positions for appeal */
  useAveragedPositions?: boolean;
  /** Weight party over candidate: (partyWeight*party + candidate)/(partyWeight+1). 2 = 2:1 party. */
  partyPositionWeight?: number;
  /**
   * @deprecated 2026-06-18 (D3) - no-op. Selected the retired presidential Org
   * scalar; general elections now use `normalizedOrgShare` regardless and the
   * engines no longer read this flag. Kept so existing call sites type-check.
   */
  usePresidentialPartyOrg?: boolean;
  /** Include NPI influence score in appeal (true for presidential, false for state) */
  includeInfluenceInAppeal?: boolean;
  /** Use nationalInfluence for reach instead of politicalInfluence (presidential elections) */
  useNationalInfluenceForReach?: boolean;
  /**
   * When true with `useNationalInfluenceForReach`, reach uses the presidential-primary
   * diminishing curve (0–1 linear-up-to-cap) instead of the sqrt-clamped `normalizeNPI`.
   */
  presidentialPrimaryNationalReach?: boolean;
  /**
   * Voting system for this state's general election.
   * "fptp" (default): applies the vote-splitting (spoiler) effect — a fraction of
   *   each third-party candidate's own allocation is drawn from the ideologically
   *   nearest major-party candidate, modelling how third parties can cause major
   *   parties to lose races they would otherwise win.
   * "rcv": no adjustment; ranked choice eliminates the spoiler dynamic entirely.
   * Only applies when there is at least one major-party candidate in the race.
   */
  votingSystem?: "fptp" | "rcv";
  /**
   * Whether this is a general election phase (FPTP penalty only applies in general,
   * not in primaries where voters are already within a single party).
   */
  isGeneralElection?: boolean;
  /**
   * Country this election belongs to. Used to look up the correct major-party set
   * for FPTP spoiler modelling. Defaults to "US" when omitted.
   */
  countryId?: CountryId;
  /**
   * UK manifesto policy-popularity multipliers, keyed party → demographic group
   * id → factor (centred on 1.0). Absent (the default) means the feature is off:
   * the per-candidate weight is multiplied by 1.0. Precomputed by the manifesto
   * layer (src/lib/uk/manifesto) so the vote engine stays generic and decoupled.
   * Epic #856 / ticket #857. Enable only after worldsim coefficient calibration.
   */
  manifestoMultipliers?: Record<string, Record<string, number>>;
  /**
   * Runtime override for whether the country is currently a one-party state.
   * When supplied, takes precedence over `COUNTRY_CONFIGS[countryId].governmentType`.
   * Pre-resolved by callers from the `countryState` collection so that a
   * mid-game system conversion (Stage-4 collapse / convention ratification)
   * immediately changes the FPTP spoiler behaviour. When omitted, falls back
   * to the compile-time COUNTRY_CONFIGS value (used by hand-built test
   * fixtures that don't carry a DB).
   */
  isOnePartyState?: boolean;
  /**
   * Parent region ID for the constituency (e.g. UK nation: "ENG", "SCO", "WAL", "NIR").
   * Used for region-specific major-party sets in FPTP spoiler modelling.
   * For US elections this is not needed (same major parties nationwide).
   */
  parentRegionId?: string;
  /**
   * Live turnout rates by demographic group ID, overriding the static
   * StateDemographics values. Used to apply GOTV, canvassing, and suppression
   * effects from StateDemographicTurnout modifiers.
   * When provided, these values take precedence over stored turnout rates.
   */
  liveTurnouts?: Record<string, number>;
  /**
   * Whether at least one human player is among the candidates in this race.
   * When true, a weight penalty is applied to every NPP candidate to reflect
   * the structural advantage active players have in general elections.
   * See NPP_GENERAL_WEIGHT_MULTIPLIER in electionEngine/constants.ts.
   */
  hasPlayerInRace?: boolean;
  /**
   * Override for FPTP spoiler rate. Defaults to FPTP_SPOILER_RATE (0.04).
   * Presidential races use a half rate (0.02) so fragmented 7-way fields don't
   * amplify into EC landslides via winner-take-all aggregation.
   * Only applied when isGeneralElection + votingSystem !== "rcv".
   */
  spoilerRate?: number;
  /**
   * When true, scale FPTP spoiler transfer by the third party's local party-org
   * advantage or disadvantage versus the nearest major party. This keeps
   * well-built third parties dangerous in states where they invested, while
   * preventing low-org third parties from draining mature major-party machines
   * at a flat national rate.
   */
  useOrgAwareSpoiler?: boolean;
  /**
   * Active per-party demographic favorability bonuses, keyed by
   * `${partyId}:${groupId}`. Each entry is an additive favorability
   * delta (e.g. +5) that multiplies the candidate's group-level weight
   * by `(1 + delta/100)`. Sourced from State of the State / National
   * Address deliveries that target a voter group; rows live in
   * `partyGroupFavorability`. Empty / unset = no bonus applied.
   */
  partyGroupFavorabilityByKey?: Map<string, number>;
  /**
   * Per-party Reg% map for the state — used by Phase 5a's
   * `regResistanceMultiplier` to model own-Reg as persuasion resistance.
   * Only consumed when `isGeneralElection === true`. Undefined / missing
   * party in the map degrades to neutral 1.0× per Phase 5a D5.
   */
  regByParty?: Map<string, number>;
  /**
   * Per-party seeded registration SHARE (0-100) for the state — feeds
   * `regBaselineMultiplier`, the concave party-baseline vote-weight scalar.
   * Populated only from `statePartyOrg.registrationShare` (seed-authored,
   * today UK-era-polling only). Undefined map / missing party degrades to
   * exactly 1.0× — worlds without the seeded field are byte-identical, and
   * the US `registration` resistance/peel lane is never double-counted.
   */
  regShareByParty?: Map<string, number>;
  /**
   * Per-party governor coattail multiplier for the state — the §7.3.2
   * `govModifier` term. Only the executive's party has an entry, scaled by
   * Governor approval (`1 + clamp((approval − BASE_APPROVAL) / 25, −1, 1) ×
   * COATTAIL_MAX_BONUS`); all others degrade to neutral 1.0×. Only consumed in
   * general elections, and only populated for in-state down-ballot races
   * (never presidential, never the executive's own race).
   */
  govModifierByParty?: Map<string, number>;
  /**
   * Unused by the distribution engines. Callers pick
   * `distributeVotesBySwingFlow` vs the legacy allocator themselves.
   * `accumulateVoteTurn` always uses swing-flow for generals.
   */
  useSwingFlowModel?: boolean;
  /**
   * Per-party presidential-coattail nominal-share multiplier. Only the
   * sitting President's party carries an entry (e.g. 1.09 at high national
   * approval, 0.91 at low); everyone else is neutral 1.0×. Applied
   * multiplicatively in the swing-flow nominal-share line alongside
   * `govModifierByParty`. Populated for general-phase non-presidential races
   * (US only). See `presidentialCoattail.ts`.
   */
  presidentialModifierByParty?: Map<string, number>;
  /**
   * Per-party off-cycle opposition multiplier. Parties outside the national
   * government receive 1.05× in eligible UK Regional Council midterms;
   * governing and coalition parties remain neutral. Undefined outside those
   * races. Applied on the nominal-share line beside executive coattails.
   */
  midtermOppositionModifierByParty?: Map<string, number>;
  /**
   * Per-party campaign funds available in this race, in the country's
   * native local currency. Higher delta between P_j and P_i implies P_j
   * has more persuasion budget — feeds the money driver. Undefined or
   * empty map = no money contribution.
   *
   * #4C: optional input — the swing-flow engine treats missing data as
   * neutral.
   */
  fundsByParty?: Map<string, number>;
  /**
   * Per-state median voter — turnout-weighted average of demographic
   * group leans. Consumed by `policyDistanceDriver` so a centrist
   * candidate is judged relative to the state's actual median voter
   * rather than abstract `(0, 0)` neutrality. Undefined falls back to
   * the original `(0, 0)` behavior for backward compatibility.
   *
   * Plumbed in M3 from `2026-05-22-per-state-median-voter.md`.
   */
  medianVoter?: { ep: number; sp: number };
  /**
   * Per-party prior seat-share in this race, in `[0, 1]`. Values across
   * the map sum to ≤ 1.0 (one rounding tolerance). Feeds the incumbency
   * driver — defenders with larger prior stakes get larger lift, smaller
   * stakes get smaller lift. Undefined / empty map = first-ever race or
   * no prior cycle (driver returns 0).
   *
   * Models the codebase's vote-share → seat-share allocation for multi-
   * seat races (US House, UK Regional Council, JP Shugiin/Sangiin, DE
   * Bundestag, etc). Single-seat races do NOT use this map: executives use
   * `incumbentPartyId` (approval curve) and US Senate uses
   * `legislativeIncumbentPartyId` (flat shield). The map holds raw prior-cycle
   * vote shares, so a single-seat race would otherwise yield a meaningless
   * margin-scaled value.
   *
   * Plumbed in A1 from `2026-05-22-swing-flow-driver-activation.md`;
   * consumed by `persuasionDrivers.ts`.
   */
  incumbentSeatShareByParty?: Map<string, number>;
  /**
   * Single-winner executive own-race only: the sitting executive's party id
   * and approval (0..100). When `incumbentPartyId` is set, the incumbency
   * driver switches to a full-magnitude directional shield/drag scaled by
   * `incumbentApproval` (see `approvalAdjustedIncumbencyBudget`). Unset for
   * legislatures / primaries / vacant offices → driver keeps the seat-share
   * fallback. Plumbed from `2026-06-22-incumbency-approval-bonus-design.md`.
   */
  incumbentPartyId?: string;
  incumbentApproval?: number;
  /**
   * Calibration-only override for `INCUMBENCY_APPROVAL_PIVOT` (the approval
   * level an incumbent must clear to earn a shield rather than a drag).
   * Production leaves this unset and gets the constant; the replay harness
   * sweeps it to measure how a recentred pivot moves real races.
   */
  incumbencyApprovalPivot?: number;
  /**
   * Executive own-race only: raw consecutive terms the incumbent PARTY has
   * already held the office (current term counts as 1). Feeds `appealWeight`'s
   * nominal-share `personalStatTenureRetention`, which erodes the
   * PI/favorability-driven reach/approval terms. The "time for a change" drag
   * itself is priced by the economic referendum channel, not here. Unset ⇒ no
   * erosion (first term / open seat / non-executive races).
   */
  incumbentConsecutiveTerms?: number;
  /**
   * Single-seat legislative own-race (US Senate): party id of the sitting
   * officeholder, set ONLY when that officeholder is a candidate in this race
   * (open seats leave it unset). When present, the incumbency driver applies a
   * flat directional shield that decays with `legislativeIncumbentTenureTerms`
   * to a permanent +1pt floor — never a drag, no approval/favorability input.
   * Takes precedence over `incumbentSeatShareByParty`. Plumbed from
   * `2026-07-15-senate-incumbency-driver-design.md`.
   */
  legislativeIncumbentPartyId?: string;
  /**
   * Single-seat legislative own-race: the term the sitting officeholder is
   * SEEKING, not the count they have already served. `computeConsecutiveTerms
   * FromWinners` seeds at 1 for the current term and then also counts the prior
   * win that seated them, so a first-termer running for re-election arrives
   * here as 2. Drives the incumbency shield's tenure decay, which is calibrated
   * against exactly that. Defaults to 1 when unset.
   *
   * NOTE the units differ from `incumbentConsecutiveTerms` and
   * `houseIncumbentTenureTermsByCandidateId`, which both count terms ALREADY
   * held. `appealWeight` normalizes this one before applying
   * `personalStatTenureRetention` so identical service earns identical erosion
   * in every lane; anything else consuming it gets the raw sought-term value.
   */
  legislativeIncumbentTenureTerms?: number;
  /**
   * Multi-seat legislative own-race (US House): per-candidate consecutive-term
   * counts, keyed by THIS cycle's `candidateId` (matching
   * `EnrichedCandidate.candidateId`). Unlike `legislativeIncumbentPartyId` /
   * `legislativeIncumbentTenureTerms` (a single scalar pair — Senate has one
   * seat, one incumbent), a House race can have several simultaneous
   * incumbents at once, one per party's returning nominee, so tenure has to be
   * a per-candidate map rather than one party id. See
   * `resolveHouseIncumbentTenures` in `singleSeatIncumbency.ts` for how this is
   * computed and why the House needs this different shape. No entry for a
   * candidateId ⇒ personalStatTenureRetention(undefined) ⇒ 1.0 ⇒ complete
   * no-op (open seat, fresh nominee, or a non-House race).
   */
  houseIncumbentTenureTermsByCandidateId?: Map<string, number>;
  /**
   * L1: enable the party-fit multiplier on each candidate's weight.
   * Penalizes candidates sitting far from their party position uniformly
   * across every demographic group. Primary-only — `primaryStaggerPhase`
   * sets this to `true`; general elections (`accumulatePresidentVoteTurn`
   * and others) leave it unset so general behavior is unchanged.
   * Calibrated via `PRIMARY_PARTY_FIT_WEIGHT` in `electionEngine/constants.ts`.
   */
  applyPartyFit?: boolean;
  /**
   * Regional bases L1: per-candidate state-org levels for the state being
   * scored. Keyed by candidateId. Consumed whenever the map is present (not
   * gated on applyPartyFit). Cap is MAX_STATE_ORG_BONUS_PRIMARY in primaries
   * and MAX_STATE_ORG_BONUS_GENERAL in generals, selected via isGeneralElection.
   * Missing entries: no bonus (multiplier 1.0).
   * Formula: `1 + (min(level, 10) / 10) × maxBonus`.
   */
  stateOrgByCandidate?: Map<string, number>;
  /**
   * Regional bases C: per-candidate home state (candidateId → stateId).
   * Consumed whenever the map is present and currentStateId is set (not
   * gated on applyPartyFit). Matching home applies 1 + HOME_STATE_BONUS_PRIMARY
   * or 1 + HOME_STATE_BONUS_GENERAL depending on isGeneralElection.
   */
  homeStateByCandidate?: Map<string, string>;
  /**
   * The state being scored in the per-state primary loop. Required when
   * either `stateOrgByCandidate` or `homeStateByCandidate` is set. Without
   * it the weight loop has no way to look up the right row in the per-
   * state map / compare to the candidate's home state.
   */
  currentStateId?: string;
  /**
   * Factor-ledger sink (see `factorLedger.ts`). When present the swing-flow
   * TEES its already-computed per-cell appeal decomposition, swing, and spoiler
   * values into the sink — pure observation, byte-identical vote math. Undefined
   * (production default for every non-presidential caller) is a complete no-op.
   */
  ledgerSink?: import("./factorLedger").LedgerSink;
  /** Electoral-unit id the ledger sink keys the current call under. */
  ledgerUnitId?: string;
  /**
   * Per-group census `bucketWeights` ("dim:bucket" → 0..1) for the granular
   * substrate, so the sink can fold each cell's appeal back onto census buckets.
   * Absent (legacy archetype path) means the ledger emits no bucket appeal.
   */
  ledgerBucketWeightsByGroup?: Map<string, Record<string, number>>;
}

/**
 * Optional multiplicand trace for `appealWeight`. When passed, the function
 * records the exact multiplicands it ALREADY multiplies — reach, candidate-fit
 * (appeal), and the product of every remaining structural term — so the ledger
 * can decompose a cell's nominal votes without recomputing anything. The
 * recorded values reproduce the return value byte-for-byte
 * (`reachMult * fitMult * restMult === return`).
 */
export interface AppealWeightTrace {
  reachMult: number;
  fitMult: number;
  restMult: number;
}

export interface AccumulateVoteTurnPreload {
  /** gameState.preset — selects the era-correct census bundle for Layer-1 turnout derivation. */
  preset?: string;
  /**
   * gameState.currentYear — CURRENT in-game year. Gates the FPTP cube-law
   * winner's bonus (#3244): active only while the year is pre-1999, so a
   * world graduates back to proportional UK Commons as its clock advances.
   */
  currentYear?: number;
  /**
   * gameState.startingYear — the world's first year. Only used to gate
   * era-checkpoint de-duplication in the Layer-1 substrate; see
   * `checkpointBakedShifts.ts`.
   */
  startingYear?: number;
  /**
   * gameState.eraSystemEnabled — when true the Layer-1 substrate resolves from
   * `currentYear` instead of the frozen seed preset. Flag off = legacy
   * behavior, byte-identical.
   */
  eraSystemEnabled?: boolean;
  /**
   * Seeded per-state snapshots (`demographicDefaults` collection), used by the
   * granular substrate to fold legislation-driven lean drift onto cells.
   */
  demographicDefaultsByState?: Map<string, StateDemographics>;
  /**
   * Per-region registration pools, for the registered-voter gate: the
   * unregistered slice of a region's electorate cannot cast a general ballot,
   * so the accrual scales its pool by (100 - unregistered)%. Regions absent
   * from the map keep the full pool (no registration data seeded).
   */
  registrationPoolByState?: Map<string, StateRegistrationPool>;
  categories: DemographicCategory[];
  stateMap: Map<string, State>;
  demographicsMap: Map<string, StateDemographics>;
  statePartyOrgsByState: Map<string, StatePartyOrg[]>;
  turnoutByState: Map<string, StateDemographicTurnout>;
  /** Current national governing/coalition party IDs, resolved once per country. */
  governingPartyIdsByCountry?: Map<CountryId, Set<string>>;
  /**
   * Per-turn memo for lookups whose inputs repeat across the elections of a
   * turn: the sitting president per country, the regional executive per
   * state, the party table per country. Create with `createVoteTurnMemo()`
   * once per phase; ~180 elections a turn were each re-reading the same few
   * documents.
   */
  turnMemo?: import("./tallyManagement").VoteTurnMemo;
}
