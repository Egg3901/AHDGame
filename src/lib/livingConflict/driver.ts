import type { Db } from "mongodb";
import type { ConflictRole, FiredEvent, LivingConflictDef, LivingConflictState } from "./types";
import {
  applyCommitment,
  emptyConflictState,
  openConflict,
  phaseFor,
  selectEvents,
  tickConflict,
} from "./engine";
import { advanceCampaignTurn, normalizeCampaignState } from "./campaign";

/**
 * The DB-facing turn driver for living conflicts. Loads a conflict's state, opens
 * it when the world enters its window, ticks it, lets its own momentum
 * (naturalPressure) climb the phases, and returns the events that fired this turn
 * with the nations each one reaches. Player commitments and responses are applied
 * elsewhere (from crisis option actions), the same way the Vietnam ladder works.
 *
 * NOT yet wired into the turn loop: it runs only where the caller invokes it
 * behind `livingConflictsEnabled`, which ships off. Kept a thin orchestration
 * over the pure engine so its logic is testable with a fake db.
 */

export const LIVING_CONFLICT_COLLECTION = "livingConflicts";

/** Who is playing which role in a given conflict, assembled by the caller. */
export interface ConflictParticipants {
  belligerents: string[];
  backerA?: string;
  backerB?: string;
  neighbors: string[];
  blocMembers: string[];
  bystanders?: string[];
}

/** Every nation named in the conflict, for "all"-affecting events. */
export function allParticipants(p: ConflictParticipants): string[] {
  const set = new Set<string>([
    ...p.belligerents,
    ...p.neighbors,
    ...p.blocMembers,
    ...(p.bystanders ?? []),
  ]);
  if (p.backerA) set.add(p.backerA);
  if (p.backerB) set.add(p.backerB);
  return [...set];
}

/** The nations that hold any of the given roles. */
export function nationsForRoles(p: ConflictParticipants, roles: ConflictRole[] | "all"): string[] {
  if (roles === "all") return allParticipants(p);
  const out = new Set<string>();
  for (const role of roles) {
    if (role === "belligerent") p.belligerents.forEach((n) => out.add(n));
    else if (role === "neighbor") p.neighbors.forEach((n) => out.add(n));
    else if (role === "bloc") p.blocMembers.forEach((n) => out.add(n));
    else if (role === "bystander") (p.bystanders ?? []).forEach((n) => out.add(n));
    else if (role === "backer_a" && p.backerA) out.add(p.backerA);
    else if (role === "backer_b" && p.backerB) out.add(p.backerB);
  }
  return [...out];
}

export async function loadConflictState(db: Db, defKey: string): Promise<LivingConflictState> {
  const doc = await db
    .collection<LivingConflictState>(LIVING_CONFLICT_COLLECTION)
    .findOne({ defKey });
  if (!doc) return emptyConflictState(defKey);
  return { ...doc, campaign: normalizeCampaignState(doc.campaign) };
}

export async function saveConflictState(db: Db, state: LivingConflictState): Promise<void> {
  await db
    .collection<LivingConflictState>(LIVING_CONFLICT_COLLECTION)
    .updateOne(
      { defKey: state.defKey },
      { $set: { ...state, updatedAt: new Date() } },
      { upsert: true }
    );
}

export interface DrivenEvent {
  fired: FiredEvent;
  affectedNations: string[];
}

export interface DriveResult {
  state: LivingConflictState;
  events: DrivenEvent[];
}

function inWindow(def: LivingConflictDef, year: number | null | undefined): boolean {
  if (def.fromYear !== undefined && (typeof year !== "number" || year < def.fromYear)) return false;
  if (def.untilYear !== undefined && (typeof year !== "number" || year > def.untilYear))
    return false;
  return true;
}

/**
 * Advance one conflict by one turn. Pure over its inputs apart from the two DB
 * calls (load/save), so the sequencing is testable against a fake db.
 */
export async function driveConflictTurn(
  db: Db,
  def: LivingConflictDef,
  participants: ConflictParticipants,
  turn: number,
  year: number | null | undefined
): Promise<DriveResult> {
  let state = await loadConflictState(db, def.key);
  if (state.lastProcessedTurn === turn) return { state, events: [] };
  const wasOpen = state.hasOpened;

  if (!state.hasOpened) {
    if (!inWindow(def, year)) {
      return { state, events: [] };
    }
    state = openConflict(state, typeof year === "number" ? year : null);
  } else if (state.emitPhaseEntryNextTurn) {
    state = {
      ...state,
      phaseTurns: 0,
      totalTurns: state.totalTurns + 1,
      emitPhaseEntryNextTurn: false,
      updatedAt: new Date(),
    };
  } else {
    state = tickConflict(state);
    const phase = phaseFor(def, state.phaseLevel);
    const natural = phase?.naturalPressure ?? 0;
    if (natural > 0) {
      state = applyCommitment(
        def,
        state,
        "a",
        natural,
        typeof year === "number" ? year : undefined
      );
    }
  }

  if (wasOpen && state.hasOpened) {
    state = { ...state, campaign: advanceCampaignTurn(state.campaign) };
  }

  const fired = selectEvents(def, state, turn);
  const events: DrivenEvent[] = fired.map((f) => ({
    fired: f,
    affectedNations: nationsForRoles(participants, f.event.affects),
  }));

  state = { ...state, lastProcessedTurn: turn };
  await saveConflictState(db, state);
  return { state, events };
}
