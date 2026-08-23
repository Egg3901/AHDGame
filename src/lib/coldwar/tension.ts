import type { Db } from "mongodb";

/**
 * Global cold-war tension: one 0–100 number the whole world shares, with a
 * short ledger of what moved it.
 *
 * Discrete events (a nuclear test, an escalation rung, a stand-down) apply
 * spikes through `applyTensionEvent`. Each turn, the tension phase relaxes the
 * value toward a floor set by the world's standing pressure — the Vietnam
 * rung, active crises, how many warheads exist — so spikes fade but a hot
 * world never reads calm. The dials layer (lib/coldwar/dials.ts) turns the
 * reading into consequences: DEFCON, procurement demand, detente goodwill.
 */

export const COLD_WAR_TENSION_COLLECTION = "coldWarTension";
export const COLD_WAR_TENSION_ID = "current";

export const TENSION_BASELINE = 12;
/** Fraction of the gap to the floor closed each turn. */
export const TENSION_RELAXATION = 0.08;
const LEDGER_CAP = 24;

export type TensionEventKind =
  "nuclear-test" | "buildup" | "escalation" | "crisis" | "detente" | "decay";

export interface TensionEvent {
  turn: number;
  kind: TensionEventKind;
  label: string;
  delta: number;
  at: Date;
}

export interface ColdWarTensionState {
  value: number;
  updatedTurn: number;
  events: TensionEvent[];
  updatedAt: Date;
}

export type TensionBand = "DETENTE" | "CALM" | "ELEVATED" | "CRISIS" | "BRINK";

export function tensionBand(value: number): TensionBand {
  if (value < 15) return "DETENTE";
  if (value < 35) return "CALM";
  if (value < 60) return "ELEVATED";
  if (value < 80) return "CRISIS";
  return "BRINK";
}

export function clampTension(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
}

/** Standing inputs the per-turn step reads off the rest of the world. */
export interface TensionPressures {
  /** Vietnam (or successor ladder) escalation level, 0 when quiet. */
  escalationLevel: number;
  /** Active world crises count. */
  activeCrises: number;
  /** Total warheads across all programmes. */
  totalWarheads: number;
}

/**
 * The floor standing pressure holds tension at: spikes decay toward this, not
 * toward zero. An armed, embroiled world stays tense without new events.
 */
export function tensionFloor(p: TensionPressures): number {
  const escalation = Math.min(30, p.escalationLevel * 4);
  const crises = Math.min(12, p.activeCrises * 3);
  const arsenal = Math.min(18, Math.sqrt(Math.max(0, p.totalWarheads)) * 1.2);
  return clampTension(TENSION_BASELINE + escalation + crises + arsenal);
}

/** One turn of relaxation toward the pressure floor. */
export function stepTension(value: number, p: TensionPressures): number {
  const floor = tensionFloor(p);
  return clampTension(value + (floor - value) * TENSION_RELAXATION * (value > floor ? 1 : 2));
}

export function emptyTensionState(): ColdWarTensionState {
  return { value: TENSION_BASELINE, updatedTurn: 0, events: [], updatedAt: new Date(0) };
}

type StoredState = ColdWarTensionState & { _id: string };

export async function getColdWarTension(db: Db): Promise<ColdWarTensionState> {
  const doc = await db
    .collection<StoredState>(COLD_WAR_TENSION_COLLECTION)
    .findOne({ _id: COLD_WAR_TENSION_ID });
  if (!doc) return emptyTensionState();
  return {
    value: clampTension(doc.value ?? TENSION_BASELINE),
    updatedTurn: doc.updatedTurn ?? 0,
    events: doc.events ?? [],
    updatedAt: doc.updatedAt ?? new Date(0),
  };
}

async function putColdWarTension(db: Db, state: ColdWarTensionState): Promise<void> {
  await db
    .collection<StoredState>(COLD_WAR_TENSION_COLLECTION)
    .updateOne(
      { _id: COLD_WAR_TENSION_ID },
      { $set: { ...state, updatedAt: new Date() } },
      { upsert: true }
    );
}

/** Apply a discrete spike (or relief, negative delta) and record it. */
export async function applyTensionEvent(
  db: Db,
  turn: number,
  kind: TensionEventKind,
  label: string,
  delta: number
): Promise<ColdWarTensionState> {
  const state = await getColdWarTension(db);
  const next: ColdWarTensionState = {
    ...state,
    value: clampTension(state.value + delta),
    events: [{ turn, kind, label, delta, at: new Date() }, ...state.events].slice(0, LEDGER_CAP),
  };
  await putColdWarTension(db, next);
  return next;
}

/**
 * The per-turn tension step: relax toward the standing-pressure floor.
 * Idempotent per turn — a re-run of the same turn is a no-op.
 */
export async function runTensionTurn(
  db: Db,
  turn: number,
  pressures: TensionPressures
): Promise<ColdWarTensionState> {
  const state = await getColdWarTension(db);
  if (state.updatedTurn >= turn) return state;
  const next: ColdWarTensionState = {
    ...state,
    value: stepTension(state.value, pressures),
    updatedTurn: turn,
  };
  await putColdWarTension(db, next);
  return next;
}
