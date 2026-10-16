/**
 * Short Term and Long Term Holdings. Purchased shares mature after 48 turns.
 * takeHoldingShares preserves cost basis and consumes the oldest purchases first.
 */
export const SHORT_TERM_HOLDING_TURNS = 48;
export type HoldingTerm = "short" | "long";
export interface ShortTermShareLot {
  acquiredTurn: number;
  shares: number;
  costBasisAnchor: number;
}
export interface ShareHoldingTerms {
  longTermShares: number;
  longTermCostBasisAnchor: number;
  shortTermLots: ShortTermShareLot[];
}
export interface HoldingPosition {
  shares: number;
  avgCostPerShare?: number;
  holdingTerms?: ShareHoldingTerms;
}

function quantity(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid share quantity");
}
function cost(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid share cost basis");
}
function validTurn(turn: number): void {
  if (!Number.isSafeInteger(turn) || turn < 0) throw new Error("Invalid holding turn");
}
export function holdingShares(terms: ShareHoldingTerms): number {
  return terms.longTermShares + terms.shortTermLots.reduce((sum, lot) => sum + lot.shares, 0);
}
export function holdingCostBasis(terms: ShareHoldingTerms): number {
  return (
    terms.longTermCostBasisAnchor +
    terms.shortTermLots.reduce((sum, lot) => sum + lot.costBasisAnchor, 0)
  );
}
export function validateHoldingTerms(terms: ShareHoldingTerms, expectedShares?: number): void {
  quantity(terms.longTermShares);
  cost(terms.longTermCostBasisAnchor);
  if (terms.longTermShares === 0 && terms.longTermCostBasisAnchor !== 0)
    throw new Error("Empty long-term holding has cost basis");
  for (const lot of terms.shortTermLots) {
    validTurn(lot.acquiredTurn);
    quantity(lot.shares);
    cost(lot.costBasisAnchor);
    if (lot.shares === 0) throw new Error("Empty short-term lot");
  }
  quantity(holdingShares(terms));
  cost(holdingCostBasis(terms));
  if (expectedShares !== undefined && holdingShares(terms) !== expectedShares)
    throw new Error("Holding terms do not match share inventory");
}
export function matureHoldingTerms(terms: ShareHoldingTerms, turn: number): ShareHoldingTerms {
  validTurn(turn);
  validateHoldingTerms(terms);
  const result: ShareHoldingTerms = {
    longTermShares: terms.longTermShares,
    longTermCostBasisAnchor: terms.longTermCostBasisAnchor,
    shortTermLots: [],
  };
  const byTurn = new Map<number, ShortTermShareLot>();
  for (const lot of terms.shortTermLots) {
    if (lot.acquiredTurn > turn) throw new Error("Share purchase is in a future turn");
    if (turn - lot.acquiredTurn >= SHORT_TERM_HOLDING_TURNS) {
      result.longTermShares += lot.shares;
      result.longTermCostBasisAnchor += lot.costBasisAnchor;
    } else {
      const merged = byTurn.get(lot.acquiredTurn) ?? {
        acquiredTurn: lot.acquiredTurn,
        shares: 0,
        costBasisAnchor: 0,
      };
      merged.shares += lot.shares;
      merged.costBasisAnchor += lot.costBasisAnchor;
      byTurn.set(lot.acquiredTurn, merged);
    }
  }
  result.shortTermLots = [...byTurn.values()].sort((a, b) => a.acquiredTurn - b.acquiredTurn);
  validateHoldingTerms(result);
  return result;
}
/** Saves without tracking are grandfathered; callers supply the rollout anchor price. */
/** Older averages were issuer-local; tracked positions and marked averages are anchor. */
export function anchorHoldingPosition<T extends HoldingPosition & { avgCostBasisUnit?: "anchor" }>(
  position: T,
  issuerFx: number
): T {
  if (!Number.isFinite(issuerFx) || issuerFx <= 0) throw new Error("Invalid holding exchange rate");
  return !position.holdingTerms &&
    position.avgCostBasisUnit !== "anchor" &&
    position.avgCostPerShare !== undefined
    ? { ...position, avgCostPerShare: position.avgCostPerShare / issuerFx }
    : position;
}
export function positionHoldingTerms(
  position: HoldingPosition,
  turn: number,
  fallbackAnchorPrice: number
): ShareHoldingTerms {
  quantity(position.shares);
  if (position.holdingTerms) {
    validateHoldingTerms(position.holdingTerms, position.shares);
    return matureHoldingTerms(position.holdingTerms, turn);
  }
  const price = position.avgCostPerShare ?? fallbackAnchorPrice;
  cost(price);
  return matureHoldingTerms(
    {
      longTermShares: position.shares,
      longTermCostBasisAnchor: position.shares * price,
      shortTermLots: [],
    },
    turn
  );
}
/** Also restores escrowed shares without resetting their original purchase age. */
export function mergeHoldingTerms(
  left: ShareHoldingTerms,
  right: ShareHoldingTerms,
  turn: number
): ShareHoldingTerms {
  validateHoldingTerms(left);
  validateHoldingTerms(right);
  return matureHoldingTerms(
    {
      longTermShares: left.longTermShares + right.longTermShares,
      longTermCostBasisAnchor: left.longTermCostBasisAnchor + right.longTermCostBasisAnchor,
      shortTermLots: [...left.shortTermLots, ...right.shortTermLots],
    },
    turn
  );
}
export function purchasedHoldingTerms(
  shares: number,
  anchorPrice: number,
  turn: number
): ShareHoldingTerms {
  quantity(shares);
  cost(anchorPrice);
  validTurn(turn);
  return {
    longTermShares: 0,
    longTermCostBasisAnchor: 0,
    shortTermLots: shares
      ? [{ acquiredTurn: turn, shares, costBasisAnchor: shares * anchorPrice }]
      : [],
  };
}
export function availableHoldingShares(terms: ShareHoldingTerms, term: HoldingTerm): number {
  return term === "long"
    ? terms.longTermShares
    : terms.shortTermLots.reduce((sum, lot) => sum + lot.shares, 0);
}
export function chooseHoldingTerm(terms: ShareHoldingTerms, requested?: HoldingTerm): HoldingTerm {
  if (requested) return requested;
  if (terms.longTermShares > 0 && terms.shortTermLots.length > 0)
    throw new Error("Choose Short Term Holdings or Long Term Holdings");
  return terms.shortTermLots.length ? "short" : "long";
}
/** Compensation removes the exact credited basis rather than a different FIFO lot. */
export function subtractHoldingTerms(
  terms: ShareHoldingTerms,
  removed: ShareHoldingTerms,
  turn: number
): ShareHoldingTerms {
  const result = matureHoldingTerms(terms, turn);
  const debit = matureHoldingTerms(removed, turn);
  result.longTermShares -= debit.longTermShares;
  result.longTermCostBasisAnchor -= debit.longTermCostBasisAnchor;
  for (const lot of debit.shortTermLots) {
    const current = result.shortTermLots.find((row) => row.acquiredTurn === lot.acquiredTurn);
    if (!current) throw new Error("Compensated purchase lot is missing");
    current.shares -= lot.shares;
    current.costBasisAnchor -= lot.costBasisAnchor;
  }
  result.shortTermLots = result.shortTermLots.filter((lot) => {
    if (!lot.shares && Math.abs(lot.costBasisAnchor) < 1e-7) return false;
    return true;
  });
  if (!result.longTermShares && Math.abs(result.longTermCostBasisAnchor) < 1e-7)
    result.longTermCostBasisAnchor = 0;
  validateHoldingTerms(result);
  return result;
}
export function takeHoldingShares(
  terms: ShareHoldingTerms,
  shares: number,
  term: HoldingTerm,
  turn: number
): { remaining: ShareHoldingTerms; taken: ShareHoldingTerms } {
  quantity(shares);
  const remaining = matureHoldingTerms(terms, turn);
  if (shares > availableHoldingShares(remaining, term))
    throw new Error("Insufficient shares in selected holding bucket");
  const taken: ShareHoldingTerms = {
    longTermShares: 0,
    longTermCostBasisAnchor: 0,
    shortTermLots: [],
  };
  if (term === "long") {
    taken.longTermShares = shares;
    taken.longTermCostBasisAnchor =
      shares === remaining.longTermShares
        ? remaining.longTermCostBasisAnchor
        : (remaining.longTermCostBasisAnchor * shares) / remaining.longTermShares;
    remaining.longTermShares -= shares;
    remaining.longTermCostBasisAnchor -= taken.longTermCostBasisAnchor;
  } else {
    let needed = shares;
    remaining.shortTermLots = remaining.shortTermLots.flatMap((lot) => {
      const count = Math.min(needed, lot.shares);
      if (!count) return [lot];
      const basis =
        count === lot.shares ? lot.costBasisAnchor : (lot.costBasisAnchor * count) / lot.shares;
      taken.shortTermLots.push({ ...lot, shares: count, costBasisAnchor: basis });
      needed -= count;
      return count === lot.shares
        ? []
        : [{ ...lot, shares: lot.shares - count, costBasisAnchor: lot.costBasisAnchor - basis }];
    });
  }
  validateHoldingTerms(remaining);
  validateHoldingTerms(taken, shares);
  return { remaining, taken };
}
/** An escrow can contain both terms after some of its lots mature. */
export function takeReservedHoldingShares(
  terms: ShareHoldingTerms,
  shares: number,
  turn: number
): { remaining: ShareHoldingTerms; taken: ShareHoldingTerms } {
  const matured = matureHoldingTerms(terms, turn);
  const long = takeHoldingShares(matured, Math.min(shares, matured.longTermShares), "long", turn);
  const short = takeHoldingShares(
    long.remaining,
    shares - holdingShares(long.taken),
    "short",
    turn
  );
  return { remaining: short.remaining, taken: mergeHoldingTerms(long.taken, short.taken, turn) };
}
export function holdingSaleGains(
  terms: ShareHoldingTerms,
  proceedsAnchor: number,
  turn: number
): { incomeGainAnchor: number; capitalGainAnchor: number; costBasisAnchor: number } {
  cost(proceedsAnchor);
  const matured = matureHoldingTerms(terms, turn);
  const total = holdingShares(matured);
  if (!total) throw new Error("Sale has no shares");
  const longProceeds = (proceedsAnchor * matured.longTermShares) / total;
  return {
    incomeGainAnchor: Math.max(
      0,
      proceedsAnchor - longProceeds - (holdingCostBasis(matured) - matured.longTermCostBasisAnchor)
    ),
    capitalGainAnchor: Math.max(0, longProceeds - matured.longTermCostBasisAnchor),
    costBasisAnchor: holdingCostBasis(matured),
  };
}
export function holdingDividendSplit(
  terms: ShareHoldingTerms,
  dividend: number,
  turn: number
): { income: number; capital: number } {
  cost(dividend);
  const matured = matureHoldingTerms(terms, turn);
  const total = holdingShares(matured);
  if (!total) return { income: 0, capital: 0 };
  const capital = (dividend * matured.longTermShares) / total;
  return { income: dividend - capital, capital };
}
/** Splits allocate whole shares by largest remainder and conserve total basis. */
export function scaleHoldingTerms(
  terms: ShareHoldingTerms,
  newShares: number,
  turn: number
): ShareHoldingTerms {
  quantity(newShares);
  const matured = matureHoldingTerms(terms, turn);
  const oldShares = holdingShares(matured);
  if (!oldShares || !newShares)
    throw new Error("Share restructure cannot erase a personal holding");
  const buckets = [
    {
      shares: matured.longTermShares,
      basis: matured.longTermCostBasisAnchor,
      acquiredTurn: undefined as number | undefined,
    },
    ...matured.shortTermLots.map((lot) => ({
      shares: lot.shares,
      basis: lot.costBasisAnchor,
      acquiredTurn: lot.acquiredTurn,
    })),
  ].map((bucket, index) => {
    const exact = (bucket.shares / oldShares) * newShares;
    return { ...bucket, index, scaled: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  const missing = newShares - buckets.reduce((sum, bucket) => sum + bucket.scaled, 0);
  const order = [...buckets]
    .filter((bucket) => bucket.shares > 0)
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < missing; i++) order[i % order.length].scaled++;
  const displacedBasis = buckets
    .filter((bucket) => !bucket.scaled)
    .reduce((sum, bucket) => sum + bucket.basis, 0);
  const largest = [...buckets].sort((a, b) => b.scaled - a.scaled || a.index - b.index)[0];
  largest.basis += displacedBasis;
  const result = {
    longTermShares: buckets[0].scaled,
    longTermCostBasisAnchor: buckets[0].scaled ? buckets[0].basis : 0,
    shortTermLots: buckets
      .slice(1)
      .filter((bucket) => bucket.scaled > 0)
      .map((bucket) => ({
        acquiredTurn: bucket.acquiredTurn!,
        shares: bucket.scaled,
        costBasisAnchor: bucket.basis,
      })),
  };
  validateHoldingTerms(result, newShares);
  return result;
}
