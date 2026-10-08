/**
 * Energy productivity ramp: output per unit of energy capacity climbs smoothly
 * with the world turn in the 1991 opening world, where energy demand runs at
 * roughly three times supply and plants take 96 turns to build.
 *
 * Pure rules: turn number and preset id in, multiplier out. No database, no
 * clock, no randomness, so the same turn always yields the same value and a
 * restarted or resumed world lands on the same curve.
 *
 * The start turn is a constant, not stored state, so there is nothing to
 * initialise or migrate. Below it the multiplier is exactly 1; it rises
 * linearly (about 0.6 percentage points a turn, no steps) to the cap and holds.
 *
 * Imports nothing on purpose: the commodity ledger imports this, and a rules
 * module that reaches back into constants would close an import cycle.
 */
export interface EnergyProductivityRamp {
  /** World turn at which the ramp begins (multiplier is exactly 1 until then). */
  startTurn: number;
  /** Turns from start to the cap. 48 turns is one game year. */
  rampTurns: number;
  /** Total output gain at the cap, as a fraction (0.3 is +30%). */
  gain: number;
}

/** Presets that carry the ramp. Every other preset is untouched. */
export const ENERGY_PRODUCTIVITY_RAMP_BY_PRESET: Readonly<Record<string, EnergyProductivityRamp>> =
  {
    "1991-default": { startTurn: 48, rampTurns: 48, gain: 0.3 },
  };

/** Sector type whose plants the ramp applies to. */
export const ENERGY_PRODUCTIVITY_RAMP_SECTOR_TYPE = "energy";

/**
 * Output multiplier for energy plants at `currentTurn`: 1 before the start,
 * 1 + gain at and after start + rampTurns, linear in between. Non-energy
 * sectors, other presets and non-finite turns return 1.
 */
export function energyProductivityMultiplier(
  sectorType: string | null | undefined,
  currentTurn: number | null | undefined,
  preset: string | null | undefined
): number {
  if (sectorType !== ENERGY_PRODUCTIVITY_RAMP_SECTOR_TYPE || !preset) return 1;
  const ramp = ENERGY_PRODUCTIVITY_RAMP_BY_PRESET[preset];
  if (!ramp) return 1;
  if (typeof currentTurn !== "number" || !Number.isFinite(currentTurn)) return 1;
  if (currentTurn <= ramp.startTurn) return 1;
  const progress = Math.min(1, (currentTurn - ramp.startTurn) / ramp.rampTurns);
  return 1 + ramp.gain * progress;
}

/**
 * Plant utilization used to scale INPUT demand: produced over nameplate
 * capacity, floored at 0 and capped at the sector's productivity multiplier
 * (1 for everything the ramp does not touch, which keeps the legacy cap).
 * Raising the cap with the ramp keeps inputs per unit of output constant: a
 * plant that makes 20% more from the same capacity buys 20% more inputs.
 */
export function plantUtilizationForInputs(
  producedUnits: number,
  capacityUnits: number,
  productivityMultiplier = 1
): number {
  const cap = Math.max(1, productivityMultiplier);
  return Math.max(0, Math.min(cap, producedUnits / capacityUnits));
}
