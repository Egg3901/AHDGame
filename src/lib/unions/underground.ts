/**
 * Illicit unions under ban, labor-side underground loop (PR1).
 *
 * While a country's unions are banned (`FederalBudget.unionsBanned`, mirrored
 * as `Union.suspended`), the legal rank-and-file loop is fully off and every
 * legal command 403s. This module is the shadow replacement: action-funded
 * underground drives that build a hidden `undergroundStrength` pool at worse
 * efficiency and real heat risk.
 *
 * No new collections. All state is shadow fields on the existing `Union` doc
 * (`undergroundStrength`, `heat`, `exposedUntilTurn`, `lastUndergroundDriveTurn`)
 * plus per-organizer banked weight on `UnionOrganizer`. Everything in this
 * file is pure so the command, the turn step, and the UI copy all share one
 * rulebook without separately reconstructing it.
 */

import { ORGANIZE_ACTION_COST } from "./unionEconomy";

/** Drive modes: slow and deniable vs fast and loud. */
export type UndergroundDriveMode = "quiet" | "mass";

/** Underground visibility of one suspended union. */
export type UndergroundStatus = "dark" | "suspected" | "exposed";

/** Vague heat readout. Labor never sees exact heat, only this bracket. */
export type UndergroundHeatText = "cold" | "warm" | "hot";

/** Underground drives cost action points only, at 2x the legal drive price. Treasury is never touched while banned. */
export const UNDERGROUND_ACTION_COST = ORGANIZE_ACTION_COST * 2;

/** Shadow-pool strength a quiet drive adds (40% of a legal drive). */
export const UNDERGROUND_QUIET_STRENGTH_GAIN = 4;
/** Shadow-pool strength a mass drive adds (90% of a legal drive, before the exposed penalty). */
export const UNDERGROUND_MASS_STRENGTH_GAIN = 9;

/** Heat a quiet drive adds, before the approval multiplier. */
export const UNDERGROUND_QUIET_HEAT = 4;
/** Heat a mass drive adds, before the approval multiplier. */
export const UNDERGROUND_MASS_HEAT = 12;

/** Heat at or above which the turn step rolls detection every turn. */
export const HEAT_DETECTION_THRESHOLD = 30;
/** Heat bled per idle turn (no drive that turn). Steady slow work stays dark. */
export const HEAT_DECAY_PER_TURN = 2;
/** Turns an exposed union stays visible once detected. */
export const EXPOSURE_LENGTH_TURNS = 6;
/** Share of the underground pool that converts to legal strength on repeal. */
export const REPEAL_UNDERGROUND_HAIRCUT = 0.5;

/** Efficiency multiplier while exposed: illicit work is halved once visible. */
export const EXPOSED_EFFICIENCY_MULTIPLIER = 0.5;

/** Detection chance per point of heat over threshold, capped. */
const DETECTION_CHANCE_PER_HEAT = 2;
const DETECTION_CHANCE_MAX = 60;

export interface UndergroundUnionState {
  undergroundStrength?: number;
  heat?: number;
  exposedUntilTurn?: number | null;
}

/** Shadow pool as stored, treating missing fields on pre-ban documents as zero. */
export function undergroundStrength(union: UndergroundUnionState): number {
  const s = union.undergroundStrength;
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 0;
}

/** Server-side heat 0-100 as stored, treating missing fields as zero. */
export function undergroundHeat(union: UndergroundUnionState): number {
  const h = union.heat;
  if (typeof h !== "number" || !Number.isFinite(h) || h <= 0) return 0;
  return Math.min(100, h);
}

/** True while the exposure window covers `currentTurn`. No permanent flags. */
export function isUnionExposed(union: UndergroundUnionState, currentTurn: number): boolean {
  return (
    typeof union.exposedUntilTurn === "number" &&
    Number.isFinite(union.exposedUntilTurn) &&
    currentTurn <= union.exposedUntilTurn
  );
}

/** Dark (unseen) / suspected (hot enough to roll) / exposed (visible). */
export function undergroundStatus(
  union: UndergroundUnionState,
  currentTurn: number
): UndergroundStatus {
  if (isUnionExposed(union, currentTurn)) return "exposed";
  if (undergroundHeat(union) >= HEAT_DETECTION_THRESHOLD) return "suspected";
  return "dark";
}

/** Vague heat readout for labor UI. Never the exact number. */
export function undergroundHeatText(union: UndergroundUnionState): UndergroundHeatText {
  const heat = undergroundHeat(union);
  if (heat >= 60) return "hot";
  if (heat >= 15) return "warm";
  return "cold";
}

/**
 * Heat multiplier from how the membership rates the bargain. A well-run
 * union's cells pass as break-room grumbling; a resented one's organizers
 * get reported. Applied per point of progress, so low approval pays more
 * heat for the same gain.
 */
export function approvalHeatMultiplier(approval: number): number {
  const a = Number.isFinite(approval) ? approval : 50;
  if (a >= 60) return 1;
  if (a >= 40) return 1.25;
  return 1.5;
}

export interface UndergroundDriveResolution {
  strengthGain: number;
  heat: number;
}

/**
 * Resolve one underground drive. Pure: strength gain is halved while
 * exposed, heat scales with approval. Treasury is never involved.
 */
export function resolveUndergroundDrive(inputs: {
  mode: UndergroundDriveMode;
  approval: number;
  exposed: boolean;
}): UndergroundDriveResolution {
  const baseGain =
    inputs.mode === "mass" ? UNDERGROUND_MASS_STRENGTH_GAIN : UNDERGROUND_QUIET_STRENGTH_GAIN;
  const baseHeat = inputs.mode === "mass" ? UNDERGROUND_MASS_HEAT : UNDERGROUND_QUIET_HEAT;
  const strengthGain =
    Math.round(baseGain * (inputs.exposed ? EXPOSED_EFFICIENCY_MULTIPLIER : 1) * 10) / 10;
  const heat = Math.round(baseHeat * approvalHeatMultiplier(inputs.approval));
  return { strengthGain, heat };
}

/**
 * Detection chance 0-100 for a union at this heat. Zero below threshold,
 * then linear per point over threshold up to the cap. Recent-drive and
 * open-case bonuses arrive with the govt enforcement pass; heat alone
 * drives V1.
 */
export function undergroundDetectionChance(heat: number): number {
  const h = Math.max(0, Math.min(100, Number.isFinite(heat) ? heat : 0));
  if (h < HEAT_DETECTION_THRESHOLD) return 0;
  return Math.min(
    DETECTION_CHANCE_MAX,
    (h - HEAT_DETECTION_THRESHOLD + 1) * DETECTION_CHANCE_PER_HEAT
  );
}

/**
 * Pure detection decision: does `roll` (1-100) beat `chance`? Roll is a
 * parameter so tests are deterministic; the turn step feeds it from the
 * seeded RNG (`src/lib/events/substrate/rng.ts`), never `Math.random()`.
 */
export function rollUndergroundDetectionOutcome(chance: number, roll: number): boolean {
  if (chance <= 0) return false;
  return roll <= chance;
}

/** Heat after one idle turn. Drives and detection both read the clamped value. */
export function decayUndergroundHeat(heat: number): number {
  const h = Math.max(0, Math.min(100, Number.isFinite(heat) ? heat : 0));
  return Math.max(0, h - HEAT_DECAY_PER_TURN);
}

/** Legal strength restored from the shadow pool on repeal (the haircut). */
export function repealUndergroundConversion(undergroundPool: number): number {
  const pool =
    typeof undergroundPool === "number" && Number.isFinite(undergroundPool) && undergroundPool > 0
      ? undergroundPool
      : 0;
  return Math.round(pool * REPEAL_UNDERGROUND_HAIRCUT * 10) / 10;
}
