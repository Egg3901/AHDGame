/**
 * Hungarian territorial lists use the Hagenbach-Bischoff quota and the strict
 * two-thirds remainder gate. Unfilled seats move to national compensation,
 * counted with D'Hondt under the November 1989 gazette correction.
 * https://njt.jog.gov.hu/jogszabaly/1989-34-00-00.0
 * https://njt.jog.gov.hu/jogszabaly/1989-84-40-00
 */
export interface Hu1991ListVote {
  partyId: string;
  votes: number;
  ballotOrder: number;
}

/** Integer strings preserve exact quota deficits through JSON and Mongo. */
export interface Hu1991FragmentVote {
  numerator: string;
  denominator: string;
}

function validLists(lists: readonly Hu1991ListVote[]): bigint {
  const ids = new Set<string>(),
    orders = new Set<number>();
  let total = BigInt(0);
  for (const row of lists) {
    if (
      !row.partyId ||
      row.partyId === "independent" ||
      ids.has(row.partyId) ||
      !Number.isSafeInteger(row.votes) ||
      row.votes < 0 ||
      !Number.isSafeInteger(row.ballotOrder) ||
      row.ballotOrder < 1 ||
      orders.has(row.ballotOrder)
    )
      throw new Error("Invalid Hungarian territorial list votes or serials");
    ids.add(row.partyId);
    orders.add(row.ballotOrder);
    total += BigInt(row.votes);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Hungarian list vote total exceeds safe integer capacity");
  return total;
}

/** A list must exceed four percent; an exact four-percent list is ineligible. */
export function eligibleHu1991Parties(lists: readonly Hu1991ListVote[]): string[] {
  const total = validLists(lists);
  if (total === BigInt(0)) return [];
  return lists.filter((row) => BigInt(row.votes) * BigInt(25) > total).map((row) => row.partyId);
}

export function countHu1991TerritorialList(
  lists: readonly Hu1991ListVote[],
  seats: number,
  eligibleParties: readonly string[]
): {
  partySeats: Record<string, number>;
  fragments: Record<string, Hu1991FragmentVote>;
  unfilledSeats: number;
} {
  const total = validLists(lists);
  if (!Number.isSafeInteger(seats) || seats < 1 || seats > 28)
    throw new Error("Invalid Hungarian statutory territorial capacity");
  const eligible = new Set(eligibleParties);
  const partySeats = Object.fromEntries(lists.map((row) => [row.partyId, 0]));
  const divisor = BigInt(seats + 1);
  const fragments: Record<string, Hu1991FragmentVote> = {};
  if (total === BigInt(0)) return { partySeats, fragments, unfilledSeats: seats };
  const remainder = new Map<string, bigint>();
  let unfilledSeats = seats;
  for (const row of lists) {
    if (!eligible.has(row.partyId)) continue;
    const count = Number((BigInt(row.votes) * divisor) / total);
    partySeats[row.partyId] = count;
    unfilledSeats -= count;
    remainder.set(row.partyId, BigInt(row.votes) * divisor - BigInt(count) * total);
  }
  if (unfilledSeats < 0) {
    // Exact quota multiples can claim seats+1 simultaneous quota tickets.
    // Bound the final tied ticket by list serial, as in the statute's serial
    // tie rule. This explicit boundary convention cannot overfill a county.
    const last = [...lists]
      .filter((row) => partySeats[row.partyId] > 0)
      .sort((a, b) => b.ballotOrder - a.ballotOrder)[0];
    if (unfilledSeats !== -1 || !last)
      throw new Error("Hungarian territorial quota has inconsistent simultaneous claims");
    partySeats[last.partyId]--;
    remainder.set(last.partyId, remainder.get(last.partyId)! + total);
    unfilledSeats = 0;
  }
  const ranked = lists
    .filter((row) => eligible.has(row.partyId))
    .sort((a, b) => {
      const diff = remainder.get(b.partyId)! - remainder.get(a.partyId)!;
      return diff > BigInt(0) ? 1 : diff < BigInt(0) ? -1 : a.ballotOrder - b.ballotOrder;
    });
  for (const row of ranked) {
    const residual = remainder.get(row.partyId)!;
    if (unfilledSeats > 0 && residual * BigInt(3) > total * BigInt(2)) {
      partySeats[row.partyId]++;
      unfilledSeats--;
      remainder.set(row.partyId, residual - total);
    }
  }
  for (const [partyId, residual] of remainder)
    fragments[partyId] = { numerator: residual.toString(), denominator: divisor.toString() };
  return { partySeats, fragments, unfilledSeats };
}

function fraction(row: Hu1991FragmentVote): { n: bigint; d: bigint } {
  if (!/^-?\d+$/.test(row.numerator) || !/^\d+$/.test(row.denominator))
    throw new Error("Invalid Hungarian exact compensation fraction");
  const n = BigInt(row.numerator),
    d = BigInt(row.denominator);
  if (d <= BigInt(0)) throw new Error("Hungarian compensation denominator must be positive");
  return { n, d };
}

export function sumHu1991Fragments(rows: readonly Hu1991FragmentVote[]): Hu1991FragmentVote {
  let n = BigInt(0),
    d = BigInt(1);
  for (const row of rows) {
    const next = fraction(row);
    n = n * next.d + next.n * d;
    d *= next.d;
    let a = n < BigInt(0) ? -n : n,
      b = d;
    while (b !== BigInt(0)) {
      const c = a % b;
      a = b;
      b = c;
    }
    n /= a;
    d /= a;
  }
  return { numerator: n.toString(), denominator: d.toString() };
}

/** Only positive, eligible national fragment pools can receive a mandate. */
export function countHu1991NationalCompensation(
  parties: readonly { partyId: string; fragments: Hu1991FragmentVote; ballotOrder: number }[],
  seats: number
): { partySeats: Record<string, number>; unfilledSeats: number } {
  if (!Number.isSafeInteger(seats) || seats < 58 || seats > 210)
    throw new Error("Invalid Hungarian national compensation capacity");
  const ids = new Set<string>(),
    orders = new Set<number>();
  const rows = parties.map((row) => {
    if (
      !row.partyId ||
      row.partyId === "independent" ||
      ids.has(row.partyId) ||
      !Number.isSafeInteger(row.ballotOrder) ||
      row.ballotOrder < 1 ||
      orders.has(row.ballotOrder)
    )
      throw new Error("Invalid Hungarian national list identity or serial");
    ids.add(row.partyId);
    orders.add(row.ballotOrder);
    return { ...row, ...fraction(row.fragments), seats: 0 };
  });
  const partySeats = Object.fromEntries(rows.map((row) => [row.partyId, 0]));
  const positive = rows.filter((row) => row.n > BigInt(0));
  if (!positive.length) return { partySeats, unfilledSeats: seats };
  for (let i = 0; i < seats; i++) {
    let best = positive[0];
    for (const row of positive.slice(1)) {
      const comparison =
        row.n * best.d * BigInt(best.seats + 1) - best.n * row.d * BigInt(row.seats + 1);
      if (
        comparison > BigInt(0) ||
        (comparison === BigInt(0) && row.ballotOrder < best.ballotOrder)
      )
        best = row;
    }
    best.seats++;
  }
  for (const row of rows) partySeats[row.partyId] = row.seats;
  return { partySeats, unfilledSeats: 0 };
}
