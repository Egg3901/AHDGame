/**
 * Splitting a shared pot. Amounts are anchor units; the caller converts each
 * share into the recipient's currency. Rounding dust stays with the house so a
 * settlement can never pay out more than it holds.
 */
export interface PotStake {
  key: string;
  anchorAmount: number;
}

export interface PotShare {
  key: string;
  anchorAmount: number;
}

/** Winners split `pot - rake` in proportion to their stakes. */
export function splitPot(
  pot: number,
  rakeRate: number,
  winners: readonly PotStake[]
): { shares: PotShare[]; rake: number } {
  const winningStake = winners.reduce((sum, w) => sum + w.anchorAmount, 0);
  if (winners.length === 0 || winningStake <= 0) return { shares: [], rake: pot };
  const distributable = pot * (1 - rakeRate);
  const shares = winners.map((w) => ({
    key: w.key,
    anchorAmount: floorCents((distributable * w.anchorAmount) / winningStake),
  }));
  const paid = shares.reduce((sum, s) => sum + s.anchorAmount, 0);
  return { shares, rake: pot - paid };
}

/**
 * Cash a finished table out by chip count. Players who finish up pay
 * `rakeRate` of their profit; players who finish down pay nothing more than
 * what they lost.
 */
export function settleByChips(
  stakes: readonly { key: string; anchorAmount: number; chips: number; startingChips: number }[],
  rakeRate: number
): { shares: PotShare[]; rake: number } {
  const pot = stakes.reduce((sum, s) => sum + s.anchorAmount, 0);
  const totalChips = stakes.reduce((sum, s) => sum + s.chips, 0);
  if (totalChips <= 0) return { shares: [], rake: pot };
  const shares = stakes.map((s) => {
    const gross = (pot * s.chips) / totalChips;
    const profit = gross - s.anchorAmount;
    const net = profit > 0 ? gross - profit * rakeRate : gross;
    return { key: s.key, anchorAmount: floorCents(net) };
  });
  const paid = shares.reduce((sum, s) => sum + s.anchorAmount, 0);
  return { shares, rake: pot - paid };
}

function floorCents(n: number): number {
  return Math.floor(n * 100) / 100;
}
