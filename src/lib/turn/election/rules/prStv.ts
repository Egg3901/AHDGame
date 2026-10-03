/**
 * Ranked proportional elections elect one candidate per seat. `countPrStv`
 * transfers surplus and eliminated votes using stored preferences, with a
 * Droop quota and weighted inclusive Gregory transfers.
 */

export interface RankedBallot {
  preferences: string[];
  /** Number of original ballots with this ranking, before any transfers. */
  weight: number;
}

export interface PrStvRound {
  count: number;
  totals: Record<string, number>;
  action: "elect" | "eliminate" | "elect_remaining";
  candidates: string[];
  transferValue: number;
  exhausted: number;
  retained: number;
  continuing: number;
  conservationResidual: number;
}

export interface PrStvResult {
  version: 1;
  transferMethod: "weighted_inclusive_gregory";
  arithmetic: "exact_rational";
  tieBreak: "countback_then_candidate_id";
  totalBallots: number;
  quota: number;
  seats: Record<string, number>;
  elected: string[];
  rounds: PrStvRound[];
}

/** Validate the original ballots against their independently stored first preferences. */
export function validateRankedBallots(
  ballots: readonly RankedBallot[] | undefined,
  firstPreferences: Readonly<Record<string, number>>
): asserts ballots is readonly RankedBallot[] {
  if (!ballots) throw new Error("PR-STV requires stored ranked ballots");
  const totals = new Map<string, number>();
  for (const ballot of ballots) {
    if (
      !Number.isSafeInteger(ballot.weight) ||
      ballot.weight <= 0 ||
      ballot.preferences.length === 0 ||
      new Set(ballot.preferences).size !== ballot.preferences.length ||
      ballot.preferences.some((id) => !id || !Object.hasOwn(firstPreferences, id))
    )
      throw new Error("PR-STV has invalid ranked ballot evidence");
    const first = ballot.preferences[0];
    totals.set(first, (totals.get(first) ?? 0) + ballot.weight);
  }
  for (const [id, votes] of Object.entries(firstPreferences)) {
    if (!Number.isSafeInteger(votes) || votes < 0 || votes !== (totals.get(id) ?? 0))
      throw new Error("PR-STV ranked ballots disagree with first preferences");
  }
}

type Fraction = { numerator: bigint; denominator: bigint };
const ZERO: Fraction = { numerator: BigInt(0), denominator: BigInt(1) };
const ONE: Fraction = { numerator: BigInt(1), denominator: BigInt(1) };

function fraction(numerator: bigint, denominator = BigInt(1)): Fraction {
  if (denominator <= BigInt(0)) throw new Error("PR-STV fraction denominator must be positive");
  let a = numerator < BigInt(0) ? -numerator : numerator;
  let b = denominator;
  while (b) [a, b] = [b, a % b];
  const divisor = a || BigInt(1);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
function add(a: Fraction, b: Fraction): Fraction {
  return fraction(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator
  );
}
function subtract(a: Fraction, b: Fraction): Fraction {
  return fraction(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator
  );
}
function multiply(a: Fraction, b: Fraction): Fraction {
  return fraction(a.numerator * b.numerator, a.denominator * b.denominator);
}
function divide(a: Fraction, b: Fraction): Fraction {
  return fraction(a.numerator * b.denominator, a.denominator * b.numerator);
}
function compareFractions(a: Fraction, b: Fraction): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}
/** Display values only; no election decision uses this decimal approximation. */
function displayValue(value: Fraction): number {
  const integer = value.numerator / value.denominator;
  const decimal =
    ((value.numerator % value.denominator) * BigInt(1_000_000_000_000)) / value.denominator;
  return Number(integer) + Number(decimal) / 1_000_000_000_000;
}

/**
 * A deterministic STV model, not Ireland's manual ballot sampling procedure.
 * Original ballot weights are integers; transfers retain fractional value.
 * Unavailable preferences are skipped, never reconstructed or redistributed
 * by party share. Equal counts use previous counts, then candidate id.
 */
export function countPrStv(
  candidateIds: readonly string[],
  seatCount: number,
  ballots: readonly RankedBallot[]
): PrStvResult {
  if (!Number.isSafeInteger(seatCount) || seatCount <= 0)
    throw new Error("PR-STV requires a positive integer seat count");
  if (new Set(candidateIds).size !== candidateIds.length || candidateIds.some((id) => !id))
    throw new Error("PR-STV requires distinct candidate identities");
  if (candidateIds.length < seatCount)
    throw new Error("PR-STV candidate field is smaller than its seat count");
  for (const ballot of ballots) {
    if (
      !Number.isSafeInteger(ballot.weight) ||
      ballot.weight <= 0 ||
      ballot.preferences.length === 0 ||
      new Set(ballot.preferences).size !== ballot.preferences.length ||
      ballot.preferences.some((id) => !id)
    )
      throw new Error("PR-STV has invalid ranked ballot evidence");
  }
  const totalBallots = ballots.reduce((sum, ballot) => sum + ballot.weight, 0);
  if (!Number.isSafeInteger(totalBallots) || totalBallots <= 0)
    throw new Error("PR-STV requires a positive safe integer ballot total");
  const totalExact = fraction(BigInt(totalBallots));
  const quotaExact = fraction(BigInt(totalBallots) / BigInt(seatCount + 1) + BigInt(1));
  const quota = displayValue(quotaExact);
  const continuing = new Set(candidateIds);
  const parcels = ballots.map((ballot) => ({
    preferences: [...ballot.preferences],
    value: fraction(BigInt(ballot.weight)),
    holder: ballot.preferences.find((id) => continuing.has(id)),
  }));
  let exhausted = parcels.filter((p) => !p.holder).reduce((sum, p) => add(sum, p.value), ZERO);
  let retained = ZERO;
  const elected: string[] = [];
  const rounds: PrStvRound[] = [];
  const seats = Object.fromEntries(candidateIds.map((id) => [id, 0]));
  const pastTotals: Record<string, Fraction>[] = [];

  while (elected.length < seatCount) {
    const exactTotals = Object.fromEntries([...continuing].map((id) => [id, ZERO]));
    for (const p of parcels)
      if (p.holder) exactTotals[p.holder] = add(exactTotals[p.holder], p.value);
    const totals = Object.fromEntries(
      Object.entries(exactTotals).map(([id, value]) => [id, displayValue(value)])
    );
    const compare = (a: string, b: string): number => {
      const current = compareFractions(exactTotals[b], exactTotals[a]);
      if (current !== 0) return current;
      for (let i = pastTotals.length - 1; i >= 0; i--) {
        const difference = compareFractions(pastTotals[i][b] ?? ZERO, pastTotals[i][a] ?? ZERO);
        if (difference !== 0) return difference;
      }
      return a < b ? -1 : a > b ? 1 : 0;
    };
    const ranked = [...continuing].sort(compare);
    let action: PrStvRound["action"];
    let selected: string[];
    let transferFraction = ZERO;
    if (continuing.size <= seatCount - elected.length) {
      action = "elect_remaining";
      selected = ranked;
      for (const id of selected) {
        seats[id] = 1;
        elected.push(id);
        continuing.delete(id);
      }
      for (const p of parcels) {
        if (p.holder && selected.includes(p.holder)) {
          retained = add(retained, p.value);
          p.holder = undefined;
          p.value = ZERO;
        }
      }
    } else {
      const winner = ranked.find((id) => compareFractions(exactTotals[id], quotaExact) >= 0);
      action = winner ? "elect" : "eliminate";
      const selectedId = winner ?? ranked[ranked.length - 1];
      selected = [selectedId];
      continuing.delete(selectedId);
      if (winner) {
        elected.push(winner);
        seats[winner] = 1;
        transferFraction = divide(subtract(exactTotals[winner], quotaExact), exactTotals[winner]);
      } else transferFraction = ONE;
      for (const p of parcels) {
        if (p.holder !== selectedId) continue;
        const transferable = multiply(p.value, transferFraction);
        retained = add(retained, subtract(p.value, transferable));
        p.value = transferable;
        p.holder = p.preferences.find((id) => continuing.has(id));
        if (!p.holder) {
          exhausted = add(exhausted, p.value);
          p.value = ZERO;
        }
      }
    }
    const continuingValue = parcels
      .filter((p) => p.holder)
      .reduce((sum, p) => add(sum, p.value), ZERO);
    const conservationResidual = subtract(
      totalExact,
      add(add(retained, exhausted), continuingValue)
    );
    if (conservationResidual.numerator !== BigInt(0))
      throw new Error("PR-STV count lost ballot value");
    pastTotals.push(exactTotals);
    rounds.push({
      count: rounds.length + 1,
      totals,
      action,
      candidates: selected,
      transferValue: displayValue(transferFraction),
      exhausted: displayValue(exhausted),
      retained: displayValue(retained),
      continuing: displayValue(continuingValue),
      conservationResidual: 0,
    });
  }
  return {
    version: 1,
    transferMethod: "weighted_inclusive_gregory",
    arithmetic: "exact_rational",
    tieBreak: "countback_then_candidate_id",
    totalBallots,
    quota,
    seats,
    elected,
    rounds,
  };
}

export interface PreferenceCandidate {
  candidateId: string;
  party: string;
  charEP: number;
  charSP: number;
}

/**
 * Synthetic voters retain the turn distributor's first preference. Their
 * later preferences favor same-party candidates, then policy proximity to
 * their first choice, then candidate id. This is a documented game model,
 * not measured historical Irish transfer behavior. Called when ballots are
 * cast, never to reconstruct old tallies.
 */
export function castRankedBallots(
  candidates: readonly PreferenceCandidate[],
  increments: Readonly<Record<string, number>>
): RankedBallot[] {
  return candidates.flatMap((first) => {
    const weight = increments[first.candidateId] ?? 0;
    if (!Number.isSafeInteger(weight) || weight < 0)
      throw new Error("PR-STV ballot increment must be a non-negative safe integer");
    if (weight === 0) return [];
    if (candidates.some((c) => !Number.isFinite(c.charEP) || !Number.isFinite(c.charSP)))
      throw new Error("PR-STV preferences require finite candidate positions");
    const sameParty = (c: PreferenceCandidate) =>
      first.party !== "independent" && c.party === first.party ? 1 : 0;
    const distance = (c: PreferenceCandidate) =>
      (c.charEP - first.charEP) ** 2 + (c.charSP - first.charSP) ** 2;
    const rest = candidates
      .filter((c) => c.candidateId !== first.candidateId)
      .sort(
        (a, b) =>
          sameParty(b) - sameParty(a) ||
          distance(a) - distance(b) ||
          (a.candidateId < b.candidateId ? -1 : 1)
      );
    return [{ weight, preferences: [first.candidateId, ...rest.map((c) => c.candidateId)] }];
  });
}

/** Compact identical rankings without losing original ballot weights. */
export function mergeRankedBallots(
  previous: readonly RankedBallot[],
  increments: readonly RankedBallot[]
): RankedBallot[] {
  const merged = new Map<string, RankedBallot>();
  for (const ballot of [...previous, ...increments]) {
    const key = JSON.stringify(ballot.preferences);
    const existing = merged.get(key);
    if (existing) existing.weight += ballot.weight;
    else merged.set(key, { preferences: [...ballot.preferences], weight: ballot.weight });
  }
  return [...merged.values()];
}
