/**
 * Per-turn driver for the regime-escalation state machine.
 *
 * Sequences each tick:
 *   1. Self-heal a "stable" row when no escalation state exists.
 *   2. Expire any timed-out active decision (default-action fires).
 *   3. Update dwell counters from this turn's scalar values.
 *   4. Compute the next stage; if changed, persist + log transition.
 *   5. Offer the new stage's decision event to the ruling-party leader.
 *
 * Phase 4 will add Stage 3 auto-faction-split firing here (before step 5);
 * Phase 6 wires the `conventionInProgress` flag + Stage 4 conversion.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getRegimeEscalationCollection } from "@/lib/db/collections/regimeEscalation";
import type {
  DecisionKind,
  EscalationState,
  RegimeStage,
  StageTransitionEvent,
} from "@/lib/db/types/regimeEscalation";
import { computeNextStage, updateDwellCounters, STAGE_THRESHOLDS } from "./regimeEscalation";
import { expireDecisionsForTurn, offerDecision } from "@/lib/onePartyState/decisionQueue";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { fireFactionSplit } from "@/lib/onePartyState/factionSplit";
import { checkForcedConversion } from "@/lib/onePartyState/systemConversion";
import { tickConventionPhase } from "@/lib/onePartyState/constitutionalConvention";

const MAX_TRANSITION_HISTORY = 50;

export interface EscalationTurnInputs {
  db: Db;
  countryId: CountryId;
  popularLegitimacy: number;
  partyConfidence: number;
  rulingLeaderCharacterId: ObjectId;
  currentTurn: number;
}

export interface EscalationTurnResult {
  fromStage: RegimeStage;
  toStage: RegimeStage;
  decisionOffered: boolean;
}

export async function processRegimeEscalationTurn(
  inp: EscalationTurnInputs
): Promise<EscalationTurnResult | null> {
  const coll = getRegimeEscalationCollection(inp.db);

  let state = await coll.findOne({ _id: inp.countryId });
  if (!state) {
    state = await ensureInitialEscalationState(inp.db, inp.countryId, inp.currentTurn);
  }

  // 0. Phase-6 convention auto-transitions. Runs first so the
  //    `conventionInProgress` flag is up-to-date when the dwell update
  //    consults it (Stage-4 dwell freezes while a convention is in
  //    progress).
  await tickConventionPhase(inp.db, inp.countryId, inp.currentTurn);

  // 1. Expire any timed-out active decisions first so the default-action
  //    fires before this turn's dwell/stage compute. (Phase 4's handlers
  //    will be invoked here once registered.)
  await expireDecisionsForTurn(inp.db, inp.countryId, inp.currentTurn);

  // 2. Update dwell counters from this turn's scalar values.
  const newDwell = updateDwellCounters({
    previous: state.dwellCounters,
    popularLegitimacy: inp.popularLegitimacy,
    partyConfidence: inp.partyConfidence,
    currentStage: state.currentStage,
    conventionInProgress: state.conventionInProgress,
    windowSizeTurns: STAGE_THRESHOLDS.stage2.windowTurns,
  });

  // 3. Compute next stage from updated dwell + current scalars.
  const nextStage = computeNextStage({
    popularLegitimacy: inp.popularLegitimacy,
    partyConfidence: inp.partyConfidence,
    dwellCounters: newDwell,
    currentStage: state.currentStage,
    conventionInProgress: state.conventionInProgress,
  });

  const fromStage = state.currentStage;
  const toStage = nextStage;
  const changed = fromStage !== toStage;

  // 4. Persist dwell + (if changed) the stage transition.
  if (changed) {
    const transition: StageTransitionEvent = {
      turn: inp.currentTurn,
      from: fromStage,
      to: toStage,
      reason: describeTransition(fromStage, toStage, inp),
      at: new Date(),
    };
    const newHistory = [transition, ...state.transitionHistory].slice(0, MAX_TRANSITION_HISTORY);

    await coll.findOneAndUpdate(
      { _id: inp.countryId },
      {
        $set: {
          currentStage: toStage,
          stageEnteredAtTurn: inp.currentTurn,
          dwellCounters: newDwell,
          transitionHistory: newHistory,
          updatedAt: new Date(),
        },
      }
    );

    // 5a. Stage 3 auto-fires the faction split BEFORE the decision is
    //     offered, so the decision payload can reference the new party.
    let factionSplit: Awaited<ReturnType<typeof fireFactionSplit>> = null;
    if (toStage === "internalChallenge") {
      factionSplit = await fireFactionSplit(inp.db, inp.countryId, inp.currentTurn);
    }

    // 5b. Offer the decision event for the new stage. `stable` is
    // unreachable here (changed && toStage !== fromStage filters it).
    if (toStage !== "stable") {
      await offerDecision(inp.db, inp.countryId, {
        kind: decisionKindForStage(toStage),
        leaderCharacterId: inp.rulingLeaderCharacterId,
        offeredAtTurn: inp.currentTurn,
        payload: factionSplit
          ? {
              defectedPartySequentialId: factionSplit.newPartySequentialId,
              defectorCount: factionSplit.defectorCount,
            }
          : {},
      });
    }

    // 6. Publish the transition to the country-history feed so players
    //    see "Regime enters Discontent stage" etc. on the country page.
    //    Fire-and-forget — non-critical, mirrors the pattern used by
    //    other turn-system history writers.
    await recordCountryEvent(inp.db, {
      countryId: inp.countryId,
      turn: inp.currentTurn,
      eventType: "regime_escalation",
      title: headlineForTransition(toStage, inp.countryId),
      details: {
        from: fromStage,
        to: toStage,
        popularLegitimacy: Number(inp.popularLegitimacy.toFixed(1)),
        partyConfidence: Number(inp.partyConfidence.toFixed(1)),
      },
    }).catch((err) =>
      console.error(`${inp.countryId} regime_escalation history write failed:`, err)
    );
  } else {
    await coll.findOneAndUpdate(
      { _id: inp.countryId },
      { $set: { dwellCounters: newDwell, updatedAt: new Date() } }
    );
  }

  // 7. Phase-6 forced-conversion check. Fires when Stage 4's
  //    `acceptPeacefully` decision parked a `conversionPendingAtTurn`
  //    that has arrived, OR when the regime has been in collapse with
  //    no convention long enough that the forced path triggers. Runs
  //    after dwell/stage compute so it sees this turn's `currentStage`.
  await checkForcedConversion(inp.db, inp.countryId, inp.currentTurn);

  return { fromStage, toStage, decisionOffered: changed && toStage !== "stable" };
}

/**
 * Self-heal the per-country regime escalation doc when it doesn't
 * exist yet. The per-turn driver normally creates the row on first
 * tick, but player-initiated actions (announceConvention) can fire
 * before the driver has run for a fresh game — those paths call this
 * helper directly so they don't have to error out on "no state".
 */
export async function ensureInitialEscalationState(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<EscalationState> {
  const coll = getRegimeEscalationCollection(db);
  const seed: EscalationState = {
    _id: countryId,
    countryId,
    currentStage: "stable",
    stageEnteredAtTurn: currentTurn,
    dwellCounters: {
      stage1: 0,
      stage2: { sustained: 0, cumulativeIn168: 0 },
      stage3: 0,
      stage4: 0,
    },
    conventionInProgress: false,
    activeDecision: null,
    decisionQueue: [],
    transitionHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  // Best-effort insert — try/catch handles the MockDb-shape-missing case
  // and the rare concurrent-init race.
  try {
    await coll.insertOne(seed);
  } catch {
    /* ignore — defensive against MockDb shape AND concurrent inserts */
  }
  return seed;
}

function decisionKindForStage(stage: RegimeStage): DecisionKind {
  switch (stage) {
    case "discontent":
      return "stage1.addressDiscontent";
    case "crisis":
      return "stage2.respondToUnrest";
    case "internalChallenge":
      return "stage3.respondToFactionSplit";
    case "collapse":
      return "stage4.faceCollapse";
    case "stable":
      throw new Error("No decision-kind defined for the stable stage");
  }
}

function describeTransition(from: RegimeStage, to: RegimeStage, inp: EscalationTurnInputs): string {
  return `${from} → ${to} (popular=${inp.popularLegitimacy.toFixed(1)}, partyConf=${inp.partyConfidence.toFixed(1)})`;
}

/**
 * Player-facing headline for the country-history feed. Keeps the
 * historical record human-readable; the structured `details` carries
 * the precise scalar values for the analytics-minded.
 */
function headlineForTransition(stage: RegimeStage, countryId: CountryId): string {
  switch (stage) {
    case "discontent":
      return `Public discontent grows in ${countryId}`;
    case "crisis":
      return `Mass protests sweep ${countryId}`;
    case "internalChallenge":
      return `Internal challenge to the ruling party in ${countryId}`;
    case "collapse":
      return `Regime in ${countryId} faces collapse`;
    case "stable":
      return `${countryId} regime stabilises`;
  }
}
