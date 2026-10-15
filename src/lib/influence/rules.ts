/**
 * Player boost pricing (Campaign and Advertise). Boosts to another player use
 * the actor's equivalent self-action quote with a 25% premium; action points
 * round down and anchor-fund costs round to the nearest unit.
 */

export const EXTERNAL_BOOST_PREMIUM = 1.25;
export const EXTERNAL_ATTACK_PREMIUM = 1.5;

export interface ExternalBoostPrice {
  actionCost: number;
  fundsCostAnchor: number;
}

export type EquivalentSelfActionQuote = {
  apCost: number;
  fundCostAnchor: number;
  statGain: number;
};

export type RepeatedSelfActionQuote =
  | { ok: true; actions: Array<{ apCost: number; fundCostAnchor: number }>; statGain: number }
  | { ok: false; error: string };

/** Accumulates ordinary self-action quotes until they cover an external boost. */
export function quoteSelfActionsForGain(
  startingStat: number,
  targetGain: number,
  quoteAtStat: (stat: number) => EquivalentSelfActionQuote | { error: string }
): RepeatedSelfActionQuote {
  if (!Number.isFinite(startingStat) || !Number.isFinite(targetGain) || targetGain <= 0) {
    return { ok: false, error: "A positive target stat increase is required." };
  }

  const actions: Array<{ apCost: number; fundCostAnchor: number }> = [];
  let stat = startingStat;
  let statGain = 0;
  while (statGain < targetGain) {
    const quote = quoteAtStat(stat);
    if ("error" in quote) return { ok: false, error: quote.error };
    if (
      !Number.isFinite(quote.statGain) ||
      quote.statGain <= 0 ||
      !Number.isFinite(quote.apCost) ||
      quote.apCost < 0 ||
      !Number.isFinite(quote.fundCostAnchor) ||
      quote.fundCostAnchor < 0
    ) {
      return { ok: false, error: "The equivalent self-action quote was invalid." };
    }
    actions.push({ apCost: quote.apCost, fundCostAnchor: quote.fundCostAnchor });
    statGain += quote.statGain;
    stat = Math.min(100, stat + quote.statGain);
    if (actions.length > 100) {
      return { ok: false, error: "Too many self-actions were required to calculate the boost." };
    }
  }
  return { ok: true, actions, statGain };
}

export function priceExternalBoost(
  selfActions: ReadonlyArray<{ apCost: number; fundCostAnchor: number }>,
  actionDistanceMultiplier = 1,
  premium = EXTERNAL_BOOST_PREMIUM
): ExternalBoostPrice {
  const selfActionCost = selfActions.reduce((total, action) => total + action.apCost, 0);
  const selfFundsCostAnchor = selfActions.reduce(
    (total, action) => total + action.fundCostAnchor,
    0
  );
  return {
    actionCost: Math.floor(selfActionCost * premium * actionDistanceMultiplier),
    fundsCostAnchor: Math.round(selfFundsCostAnchor * premium),
  };
}
