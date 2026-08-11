/**
 * Phase-8 simulation harness for end-to-end regime-collapse scenarios.
 *
 * Design choice: instead of standing up an in-memory MongoDB and
 * running the full per-turn driver chain (which would force us to
 * mock 8+ collections + decision-handler dispatch + history writes
 * for tests whose questions are really about drift-coefficient
 * calibration), the harness composes the same pure functions the
 * per-turn drivers wrap — `computePopularTurnDrift`,
 * `computeNextStage`, `updateDwellCounters`, and the intra-party
 * drift formula — directly on an in-memory state object.
 *
 * What this does NOT exercise:
 *   - Decision-queue dispatch (mocked separately in registry tests)
 *   - Reform-action handlers (covered in reformActions.test.ts)
 *   - History persistence (covered by individual driver tests)
 *
 * What this DOES exercise:
 *   - Per-turn drift accumulation under sustained inputs
 *   - Stage-transition timing against dwell windows
 *   - Convention / conversion gating logic
 *   - Intra-party ↔ popular coupling
 *
 * The collapse-time floor (132 turns) and the design-doc turn ranges
 * are validated against this harness's output. If the harness disagrees
 * with what the DB-backed driver would do, the drivers themselves have
 * a bug — re-run the unit tests to localise it.
 */
import type { PopularMoodAxisProfile } from "@/lib/constants/popularMoodProfiles";
import { CN_POPULAR_MOOD_PROFILE } from "@/lib/constants/popularMoodProfiles";
import { computePopularTurnDrift, type PopularTurnInputs } from "@/lib/turn/popularLegitimacyTurn";
import {
  computeNextStage,
  updateDwellCounters,
  STAGE_THRESHOLDS,
  type DwellUpdateInputs,
} from "@/lib/turn/regimeEscalation";
import {
  INITIAL_POPULAR_LEGITIMACY,
  MAX_POPULAR_LEGITIMACY,
  MIN_POPULAR_LEGITIMACY,
} from "@/lib/turn/popularLegitimacy";
import {
  INITIAL_CONFIDENCE,
  MIN_CONFIDENCE,
  MAX_CONFIDENCE,
} from "@/lib/turn/rulingPartyConfidence";
import { popularLegitimacyBleedIntoParty } from "@/lib/turn/rulingPartyPriorities";
import type { DwellCounters, RegimeStage } from "@/lib/db/types/regimeEscalation";
import type {
  EconomicSignals,
  ElectionCredibilitySignals,
  EnactedBillInput,
  PurgeEventInput,
} from "@/lib/turn/popularLegitimacyDrivers";

export interface SimTurnInputs {
  economic: EconomicSignals;
  purges: PurgeEventInput[];
  enactedBills: EnactedBillInput[];
  election: ElectionCredibilitySignals;
  /** Per-turn intra-party shock (e.g. policy alignment, purge feedback). */
  intraPartyShock?: number;
}

export interface SimSnapshot {
  turn: number;
  popularLegitimacy: number;
  partyConfidence: number;
  stage: RegimeStage;
  dwellCounters: DwellCounters;
  conventionInProgress: boolean;
  governmentType: "onePartyState" | "parliamentaryRepublic" | "presidential";
}

export interface SimRunInputs {
  turns: number;
  /** Starting popular legitimacy (default INITIAL = 75). */
  initialPopular?: number;
  /** Starting intra-party confidence (default INITIAL = 75). */
  initialConfidence?: number;
  /** Mood profile (default CN). */
  moodProfile?: PopularMoodAxisProfile;
  /** Per-turn input source. Called once per turn, 1-indexed. */
  inputsForTurn: (turn: number, snapshot: SimSnapshot) => SimTurnInputs;
  /**
   * Optional callback fired after each turn's snapshot. Use to inject
   * decision-handler effects (announce convention, apply reform
   * boosts, etc.) into the running state via the mutator returned.
   */
  onTurn?: (turn: number, snapshot: SimSnapshot, ctl: SimMutators) => void;
}

/**
 * Mutators surfaced to `onTurn` so test scenarios can model decision
 * resolutions + reform actions without round-tripping through the DB.
 * The mutators write directly to the in-memory state; the simulated
 * stage compute on the next turn sees the new values.
 */
export interface SimMutators {
  setPopular: (value: number) => void;
  setConfidence: (value: number) => void;
  resetStage3Dwell: () => void;
  announceConvention: (atTurn: number, draftDeadlineTurn: number) => void;
  submitConventionDraft: (targetSystem: SimSnapshot["governmentType"]) => void;
  clearConvention: () => void;
  setStage: (stage: RegimeStage) => void;
  flipGovernmentType: (to: SimSnapshot["governmentType"]) => void;
  /** Append a per-turn additive popular boost for `durationTurns`. */
  addBoost: (perTurnDelta: number, durationTurns: number) => void;
}

interface Boost {
  perTurnDelta: number;
  untilTurn: number;
}

interface ConventionState {
  phase: "announced" | "draft" | "ratification";
  announcedAtTurn: number;
  draftDeadlineTurn: number;
  targetSystem?: SimSnapshot["governmentType"];
  electionDelayTurns: number;
}

const DEFAULT_ELECTION_DELAY_TURNS = 24;

/**
 * Run `turns` simulated turns and return per-turn snapshots.
 *
 * Stage transitions go through the same `computeNextStage` the per-
 * turn driver uses. Convention auto-transitions are inlined here to
 * match `tickConventionPhase`'s rules without round-tripping through
 * the DB.
 */
export function runSimTurns(inp: SimRunInputs): SimSnapshot[] {
  const moodProfile = inp.moodProfile ?? CN_POPULAR_MOOD_PROFILE;
  let popularLegitimacy = inp.initialPopular ?? INITIAL_POPULAR_LEGITIMACY;
  let partyConfidence = inp.initialConfidence ?? INITIAL_CONFIDENCE;
  let stage: RegimeStage = "stable";
  let dwellCounters: DwellCounters = {
    stage1: 0,
    stage2: { sustained: 0, cumulativeIn168: 0 },
    stage3: 0,
    stage4: 0,
  };
  let conventionInProgress = false;
  let convention: ConventionState | null = null;
  let governmentType: SimSnapshot["governmentType"] = "onePartyState";
  let boosts: Boost[] = [];

  const snapshots: SimSnapshot[] = [];

  for (let turn = 1; turn <= inp.turns; turn++) {
    // Stop simulating drift once the regime has converted out of OPS —
    // the drivers gate on hasLeaderConfidenceModel which flips at
    // conversion. Snapshots still record the post-conversion stage.
    if (governmentType !== "onePartyState") {
      snapshots.push({
        turn,
        popularLegitimacy,
        partyConfidence,
        stage,
        dwellCounters,
        conventionInProgress,
        governmentType,
      });
      continue;
    }

    // 1. Convention auto-transitions (mirrors tickConventionPhase).
    if (convention !== null) {
      const conv: ConventionState = convention;
      if (conv.phase === "announced" && turn >= conv.draftDeadlineTurn) {
        convention = null;
        conventionInProgress = false;
      } else if (conv.phase === "draft" && turn >= conv.draftDeadlineTurn) {
        convention = { ...conv, phase: "ratification" };
      } else if (conv.phase === "ratification") {
        const electionTurn = conv.draftDeadlineTurn + conv.electionDelayTurns;
        if (turn >= electionTurn && conv.targetSystem) {
          governmentType = conv.targetSystem;
          convention = null;
          conventionInProgress = false;
        }
      }
    }

    const inputs = inp.inputsForTurn(turn, {
      turn,
      popularLegitimacy,
      partyConfidence,
      stage,
      dwellCounters,
      conventionInProgress,
      governmentType,
    });

    // 2. Popular drift (sums all 6 driver components + boosts).
    const popularInputs: PopularTurnInputs = {
      currentLegitimacy: popularLegitimacy,
      partyConfidence,
      economic: inputs.economic,
      purges: inputs.purges,
      enactedBills: inputs.enactedBills,
      election: inputs.election,
      moodProfile,
      boosts: boosts.map((b) => ({
        source: "sim",
        perTurnDelta: b.perTurnDelta,
        untilTurn: b.untilTurn,
      })),
      currentTurn: turn,
    };
    const drift = computePopularTurnDrift(popularInputs);
    popularLegitimacy = clamp(
      popularLegitimacy + drift.total,
      MIN_POPULAR_LEGITIMACY,
      MAX_POPULAR_LEGITIMACY
    );

    // 3. Intra-party drift: only the popular-bleed coupling + any
    //    test-supplied shock. Other intra-party drivers (purges, policy
    //    alignment, renewal bumps) are covered by their own unit tests.
    const intraBleed = popularLegitimacyBleedIntoParty(popularLegitimacy);
    partyConfidence = clamp(
      partyConfidence + intraBleed + (inputs.intraPartyShock ?? 0),
      MIN_CONFIDENCE,
      MAX_CONFIDENCE
    );

    // 4. Evict expired boosts.
    boosts = boosts.filter((b) => b.untilTurn >= turn);

    // 5. Dwell counters + stage transition.
    const dwellIn: DwellUpdateInputs = {
      previous: dwellCounters,
      popularLegitimacy,
      partyConfidence,
      currentStage: stage,
      conventionInProgress,
      windowSizeTurns: STAGE_THRESHOLDS.stage2.windowTurns,
    };
    dwellCounters = updateDwellCounters(dwellIn);

    const nextStage = computeNextStage({
      popularLegitimacy,
      partyConfidence,
      dwellCounters,
      currentStage: stage,
      conventionInProgress,
    });
    stage = nextStage;

    const snapshot: SimSnapshot = {
      turn,
      popularLegitimacy,
      partyConfidence,
      stage,
      dwellCounters,
      conventionInProgress,
      governmentType,
    };

    // 6. onTurn callback for decision/reform mutations.
    if (inp.onTurn) {
      const mutators: SimMutators = {
        setPopular: (v) => {
          popularLegitimacy = clamp(v, MIN_POPULAR_LEGITIMACY, MAX_POPULAR_LEGITIMACY);
        },
        setConfidence: (v) => {
          partyConfidence = clamp(v, MIN_CONFIDENCE, MAX_CONFIDENCE);
        },
        resetStage3Dwell: () => {
          dwellCounters = { ...dwellCounters, stage3: 0 };
        },
        announceConvention: (atTurn, draftDeadlineTurn) => {
          convention = {
            phase: "announced",
            announcedAtTurn: atTurn,
            draftDeadlineTurn,
            electionDelayTurns: DEFAULT_ELECTION_DELAY_TURNS,
          };
          conventionInProgress = true;
        },
        submitConventionDraft: (target) => {
          if (convention) {
            convention = { ...convention, phase: "draft", targetSystem: target };
          }
        },
        clearConvention: () => {
          convention = null;
          conventionInProgress = false;
        },
        setStage: (s) => {
          stage = s;
        },
        flipGovernmentType: (to) => {
          governmentType = to;
        },
        addBoost: (perTurnDelta, durationTurns) => {
          boosts.push({ perTurnDelta, untilTurn: turn + durationTurns });
        },
      };
      inp.onTurn(turn, snapshot, mutators);
      // Sync snapshot to any mutations the callback applied.
      snapshot.popularLegitimacy = popularLegitimacy;
      snapshot.partyConfidence = partyConfidence;
      snapshot.stage = stage;
      snapshot.dwellCounters = dwellCounters;
      snapshot.conventionInProgress = conventionInProgress;
      snapshot.governmentType = governmentType;
    }

    snapshots.push(snapshot);
  }

  return snapshots;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Quiet-turn baseline inputs — neutral economy, no purges, no bills,
 * no election. Useful as the spread base for scenario overrides.
 */
export function quietInputs(): SimTurnInputs {
  return {
    economic: {
      gdpGrowthAnnualPct: 2.5,
      unemploymentDeltaPct: 0,
      inflationDeviationFromTargetPct: 0,
    },
    purges: [],
    enactedBills: [],
    election: { isElectionTurn: false, opsMultiplier: 1.0 },
  };
}
