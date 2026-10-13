/**
 * NPP engine 6.6: autonomous central banks answer sharp currency moves (v6).
 *
 * Below v6 an autonomous chair's rate target is a closed-economy Taylor rule:
 * inflation and growth only. A currency could fall 30% in a month and the bank
 * would not move until the inflation it imports showed up in the data (owner
 * note 2026-10-02, kanban 190898).
 *
 * At v6 the target carries an exchange-rate term for a floating currency: the
 * currency's move over `FX_LOOKBACK_TURNS`, past a dead band, raises the target
 * when the currency has fallen and lowers it (at half weight) when it has
 * risen. The term only shifts the target; the existing bounded step, cooldown
 * and rate ceiling still decide how far the rate actually moves.
 */

export const FX_LOOKBACK_TURNS = 24;
/** Moves inside this fraction are treated as noise. */
export const FX_DEAD_BAND = 0.05;
/** Rate points per unit of move past the band: 0.1 points per 1%. */
export const FX_RATE_COEF = 10;
/** Appreciation is answered more slowly than depreciation. */
export const FX_APPRECIATION_WEIGHT = 0.5;
/** Largest shift the term can apply to the target, in rate points. */
export const FX_MAX_ADJUSTMENT = 3;

/**
 * Fractional depreciation of the local currency over the lookback: positive
 * when the currency has fallen. `rate` is local units per internal unit, so a
 * rising rate is a weaker currency. Null when there is no snapshot old enough.
 */
export function fxDepreciation(
  history: ReadonlyArray<{ turn: number; rate: number }> | undefined,
  currentRate: number,
  currentTurn: number
): number | null {
  if (!history || history.length === 0 || !(currentRate > 0)) return null;
  const cutoff = currentTurn - FX_LOOKBACK_TURNS;
  let past: { turn: number; rate: number } | null = null;
  for (const snapshot of history) {
    if (snapshot.turn > cutoff || !(snapshot.rate > 0)) continue;
    if (!past || snapshot.turn > past.turn) past = snapshot;
  }
  return past ? currentRate / past.rate - 1 : null;
}

/** Shift to the rate target, in rate points, for a depreciation fraction. */
export function fxRateAdjustment(depreciation: number | null): number {
  if (depreciation == null || !Number.isFinite(depreciation)) return 0;
  const excess = Math.abs(depreciation) - FX_DEAD_BAND;
  if (excess <= 0) return 0;
  const raw = excess * FX_RATE_COEF * (depreciation > 0 ? 1 : -FX_APPRECIATION_WEIGHT);
  return Math.max(-FX_MAX_ADJUSTMENT, Math.min(FX_MAX_ADJUSTMENT, raw));
}
