/**
 * Settlement-crisis turn phase — the only per-turn write path for the German
 * Question.
 *
 * Runs AFTER the alignment phase: seat direction is read from live bloc
 * membership, which the alignment and international-organisations phases write.
 *
 * Order within the tick: drain and apply this turn's plays, spread any
 * settlement-level play equally, roll Bonn's drift, recompute the index from
 * the institutions it is derived from, then test the thresholds. The index is
 * never written directly — `recomputePosition` owns it, which is what keeps the
 * masthead figure and the four institution cards from ever disagreeing.
 */
import type { Db, Filter } from "mongodb";
import { getSettlementCrisesCollection, getSettlementPlaysCollection } from "@/lib/db/collections";
import type {
  SettlementCrisisDoc,
  SettlementInstitutionState,
  SettlementSeatState,
} from "@/lib/db/types/settlementCrisis";
import type { SettlementPlayDoc } from "@/lib/db/types/settlementPlay";
import { makeSeededRng } from "@/lib/events/substrate/rng";
import {
  DRIFT_HISTORY_LENGTH,
  SEAT_CAPITAL_CAP,
  getPlay,
  getSeat,
} from "@/lib/constants/settlementCrisis";
import { applyToInstitution, recomputePosition } from "@/lib/settlement/position";
import { driftSeedFor, rollInstitutionDrift, weightedDrift } from "@/lib/settlement/drift";
import { resolvePlayBatch, type ResolvedBatch } from "@/lib/settlement/resolvePlays";
import { isArmed, nextHeat, outcomeFor } from "@/lib/settlement/outcome";
import { isSettlementCrisisEnabled } from "@/lib/settlement/featureFlag";
import { levyMobilisation } from "@/lib/settlement/mobilisation";
import { claimStatusTransition } from "@/lib/turn/atomicClaim";
import type { GameState } from "@/lib/db/types";

export interface SettlementTurnResult {
  playsResolved: number;
  institutionsMoved: number;
  crisesResolved: number;
  heat: number;
  position: number;
  /** Seat countries charged a mobilisation levy this tick. */
  countriesLevied: number;
}

/**
 * A fresh zero result. Deliberately a factory rather than a shared constant —
 * the value is handed straight to `phaseResults.settlement` and written into the
 * turn log, and a shared object would let one tick's mutation leak into every
 * later idle tick.
 */
const idle = (): SettlementTurnResult => ({
  playsResolved: 0,
  institutionsMoved: 0,
  crisesResolved: 0,
  heat: 0,
  position: 0,
  countriesLevied: 0,
});

export async function processSettlementTurn(
  db: Db,
  currentTurn: number
): Promise<SettlementTurnResult> {
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { settlementCrisisEnabled: 1 } });
  if (!(await isSettlementCrisisEnabled(gameState ?? {}))) return idle();

  const crises = await getSettlementCrisesCollection(db);
  const crisis = await crises.findOne({ status: "open" } as Filter<SettlementCrisisDoc>);
  // `frozen` and `resolved` are both excluded by the query; the explicit guard
  // keeps this correct if the query is ever widened.
  if (!crisis || crisis.status !== "open") return idle();

  // A crisis with no institutions has no index to derive. Bail rather than
  // continue: `recomputePosition([])` is 0, which is below the lock threshold,
  // so a malformed document would otherwise resolve itself for the incumbent on
  // the very next tick.
  if (crisis.institutions.length === 0) return idle();

  // CLAIM THE TICK before touching anything. Two overlapping turn runs would
  // otherwise both read this snapshot; the one that loses the per-play claims
  // still computes a drift-only result and `$set`s it over the winner's write,
  // discarding every play that landed this turn. Claiming here makes the whole
  // tick single-writer, and the per-play claims below remain as the guard
  // against a commit route racing the phase.
  const wonTick = await claimStatusTransition(
    db,
    "settlementCrises",
    { _id: crisis._id, lastTickedTurn: { $ne: currentTurn } },
    { $set: { lastTickedTurn: currentTurn } }
  );
  if (!wonTick) return idle();

  const plays = await getSettlementPlaysCollection(db);
  const pending = await plays
    .find({ crisisId: crisis._id, resolvedTurn: null } as Filter<SettlementPlayDoc>)
    .toArray();

  // CLAIM each play before applying it. This project has had overlapping turn
  // runs from rolling deploys, and a twice-applied swing is not replayable.
  // Claiming on `resolvedTurn` is what makes the second runner's update match
  // nothing, because it is the same field the stamp below writes.
  //
  // Routed through `claimStatusTransition` rather than a local
  // `findOneAndUpdate`: that helper is the repo's established claim primitive
  // and tests truthiness on `matchedCount === 1`, which is unambiguous.
  // `findOneAndUpdate` returns the document on driver v6+ but `{ value: doc }`
  // before it, so a bare truthiness check there silently stops rejecting the
  // second runner on a driver downgrade.
  const claimed: SettlementPlayDoc[] = [];
  for (const candidate of pending) {
    const won = await claimStatusTransition(
      db,
      "settlementPlays",
      { _id: candidate._id, resolvedTurn: null },
      { $set: { resolvedTurn: currentTurn } }
    );
    if (won) claimed.push(candidate);
  }

  const batch = resolvePlayBatch(claimed);

  // Stamp what each play actually bought, so a player can audit their spend.
  for (const stamp of batch.stamped) {
    await plays.updateOne(
      { _id: stamp.id },
      { $set: { resolvedTurn: currentTurn, appliedPoints: stamp.appliedPoints } }
    );
  }

  // Drift is drawn from ONE seeded rng per tick, advanced in the stored
  // institution order, so a replay reproduces the identical rolls.
  const rng = makeSeededRng(driftSeedFor(currentTurn));

  let institutionsMoved = 0;
  const institutions: SettlementInstitutionState[] = crisis.institutions.map((inst) => {
    const fromPlays = batch.perInstitution.get(inst.id) ?? 0;
    // A settlement-level play is added EQUALLY to every institution: adding the
    // same delta to each moves the weighted mean by exactly that delta, so the
    // play lands at its stated value without a second write path to the index.
    const delta = fromPlays + batch.settlementDelta;
    const withPlays = applyToInstitution(inst, delta);
    const drift = rollInstitutionDrift({
      institutionId: inst.id,
      position: withPlays.position,
      rng,
    });
    if (delta !== 0) institutionsMoved++;
    const moved = applyToInstitution(withPlays, drift);
    return { ...moved, lastDrift: drift, lastPlay: lastPlayFor(inst, claimed, currentTurn) };
  });

  const position = recomputePosition(institutions);
  const heat = nextHeat({ current: crisis.ladder.heat, added: batch.heatAdded });
  const outcome = outcomeFor(position);

  // Charged on the heat the crisis is at AFTER this tick's decay, so a bloc that
  // let the ladder fall pays nothing for the turn it stepped back.
  const armed = isArmed(heat);
  const mobilisation = await levyMobilisation(db, { armed });
  // The stamp survives only while the ladder is actually at the top; letting it
  // linger would leave a disarmed crisis looking armed to the declare route.
  const armedTurn = armed ? (crisis.ladder.armedTurn ?? currentTurn) : null;

  const driftHistory = [
    weightedDrift(institutions.map((i) => ({ weight: i.weight, drift: i.lastDrift }))),
    ...crisis.driftHistory,
  ].slice(0, DRIFT_HISTORY_LENGTH);

  const seats = crisis.seats.map((seat) => accrue(seat, claimed, batch, currentTurn));

  await crises.updateOne(
    { _id: crisis._id },
    {
      $set: {
        institutions,
        seats,
        position,
        driftHistory,
        ladder: { heat, armedTurn },
        status: outcome ? "resolved" : "open",
        outcome,
        resolvedTurn: outcome ? currentTurn : null,
        updatedAt: new Date(),
      },
    }
  );

  return {
    playsResolved: claimed.length,
    institutionsMoved,
    crisesResolved: outcome ? 1 : 0,
    heat,
    position,
    countriesLevied: mobilisation.countriesLevied,
  };
}

/** The most recent play against one institution this turn, for the card. */
function lastPlayFor(
  inst: SettlementInstitutionState,
  claimed: readonly SettlementPlayDoc[],
  turn: number
): SettlementInstitutionState["lastPlay"] {
  const hits = claimed.filter((p) => p.targetInstitutionId === inst.id);
  const latest = hits[hits.length - 1];
  if (!latest) return inst.lastPlay;
  const def = getPlay(latest.playId);
  return { seatId: latest.seatId, label: def?.name ?? latest.playId, turn };
}

/** This turn's capital accrual, action reset and committed-points credit. */
function accrue(
  seat: SettlementSeatState,
  claimed: readonly SettlementPlayDoc[],
  batch: ResolvedBatch,
  turn: number
): SettlementSeatState {
  const def = getSeat(seat.id);
  const perTurn = def?.capitalPerTurn ?? 0;

  const ids = new Set(claimed.filter((p) => p.seatId === seat.id).map((p) => String(p._id)));
  const credited = batch.stamped
    .filter((s) => ids.has(String(s.id)))
    .reduce((sum, s) => sum + Math.abs(s.appliedPoints), 0);

  return {
    ...seat,
    capital: Math.min(SEAT_CAPITAL_CAP, seat.capital + perTurn),
    actionsUsedTurn: 0,
    lastActedTurn: ids.size > 0 ? turn : seat.lastActedTurn,
    committedPoints: seat.committedPoints + credited,
  };
}
