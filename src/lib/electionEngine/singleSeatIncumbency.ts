/**
 * Officeholder-based incumbency resolution for single-seat legislative races
 * (US Senate). Finds the sitting senator, guards against open seats (the
 * incumbent must actually be running), and counts their consecutive terms in
 * the seat. Feeds the flat-shield branch of `incumbencyDriver`.
 *
 * See docs/superpowers/specs/2026-07-15-senate-incumbency-driver-design.md.
 */

import type { Db } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  ElectedOfficial,
} from "@/lib/db/types";
import { getElectionSeatKey } from "@/lib/turn/autoReelectionEntry";
import { getMultiSeatMinShare } from "@/lib/turn/election/seatAllocation";

/**
 * True for single-winner legislative races that use the officeholder-based flat
 * incumbency shield. US Senate only for now; other single-winner legislative
 * offices can be added here. Executives (governor/president) and multi-seat
 * proportional chambers are intentionally excluded.
 */
export function isSingleSeatLegislativeRace(election: Election): boolean {
  // Country-scoped: BR reuses the literal "senate" electionType for its
  // 3-seats-per-state regional Senate races, which are multi-seat PR and must
  // NOT take the US flat-shield / single-winner branches (they would skip the
  // seat-share incumbency path and mis-route resolution sweeps).
  return election.electionType === "senate" && (election.countryId ?? "US") === "US";
}

/**
 * Same-person identity within a seat's history: characterId when present, else
 * nppId. Returns null when neither is set.
 */
function identityOf(rec: {
  characterId?: { toString(): string } | null;
  nppId?: { toString(): string } | null;
}): string | null {
  return rec.characterId?.toString() ?? rec.nppId?.toString() ?? null;
}

/**
 * Consecutive terms = current term (1) plus each leading prior winner whose
 * identity matches the incumbent, stopping at the first mismatch or null.
 * `orderedPriorWinnerIdentities` must be newest → oldest.
 */
export function computeConsecutiveTermsFromWinners(
  incumbentIdentity: string,
  orderedPriorWinnerIdentities: (string | null)[]
): number {
  let terms = 1;
  for (const winner of orderedPriorWinnerIdentities) {
    if (winner && winner === incumbentIdentity) terms += 1;
    else break;
  }
  return terms;
}

/** Winner identity of a resolved election: highest-vote candidate in the
 *  finalized tally, mapped to its characterId/nppId. Null when unfinalized or
 *  no votes. */
async function getElectionWinnerIdentity(election: Election, db: Db): Promise<string | null> {
  const tally = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId: election._id });
  if (!tally || !tally.finalized) return null;

  let winnerCandidateId: string | undefined;
  let maxVotes = -Infinity;
  for (const [candidateId, votes] of Object.entries(tally.totalVotes)) {
    if (typeof votes === "number" && votes > maxVotes) {
      maxVotes = votes;
      winnerCandidateId = candidateId;
    }
  }
  if (winnerCandidateId == null) return null;

  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ electionId: election._id })
    .toArray();
  const winner = candidates.find((c) => c._id.toString() === winnerCandidateId);
  return winner ? identityOf(winner) : null;
}

/**
 * Resolve the sitting senator for `election`'s seat and their consecutive-term
 * count, or null when the race is out of scope, the seat is vacant, or the
 * incumbent is not among `runningCandidateIdentities` (open seat).
 */
export async function resolveSingleSeatLegislativeIncumbent(
  election: Election,
  runningCandidateIdentities: Set<string>,
  db: Db
): Promise<{ incumbentPartyId: string; tenureTerms: number } | null> {
  if (!isSingleSeatLegislativeRace(election)) return null;

  const countryId = election.countryId ?? "US";
  const filter: Record<string, unknown> = {
    officeType: "senate",
    state: election.state,
    countryId,
  };
  if (election.senateClass) filter.senateClass = election.senateClass;

  const official = await db.collection<ElectedOfficial>("electedOfficials").findOne(filter);
  if (!official || !official.party) return null;

  const incumbentIdentity = identityOf(official);
  if (!incumbentIdentity) return null;

  // Open-seat guard: the sitting officeholder must actually be running.
  if (!runningCandidateIdentities.has(incumbentIdentity)) return null;

  // Tenure walk: prior resolved elections on this seat, newest → oldest.
  const seatKey = getElectionSeatKey(election);
  const allResolved = await db
    .collection<Election>("elections")
    .find({ countryId, state: election.state, status: "resolved" })
    .toArray();
  const priorsOnSeat = allResolved
    .filter((p) => p.cycle < election.cycle && getElectionSeatKey(p) === seatKey)
    .sort((a, b) => b.cycle - a.cycle);

  const winnerIdentities: (string | null)[] = [];
  for (const prior of priorsOnSeat) {
    winnerIdentities.push(await getElectionWinnerIdentity(prior, db));
  }

  const tenureTerms = computeConsecutiveTermsFromWinners(incumbentIdentity, winnerIdentities);
  return { incumbentPartyId: official.party, tenureTerms };
}

// ─── US House (multi-seat) incumbency ───────────────────────────────────────
//
// The pattern above does NOT extend to the US House, and forcing it to is the
// wrong shape rather than a missing detail:
//
//  1. A House race isn't single-seat. A state's whole House delegation is one
//     Election with `totalSeats` > 1, resolved by proportional/majoritarian
//     seat allocation (`allocateSeats`) or, with redistricting on, per-district
//     quota assignment (`districtedHouseResolution`). Several parties' nominees
//     can simultaneously be "the incumbent" for their own slice of the
//     delegation — there is no single officeholder to look up the way
//     `{ officeType: "senate", state, senateClass }` finds exactly one row.
//  2. There is no persisted per-district (or per-candidate) tenure counter to
//     read: `ElectedOfficial` house rows are deleted and rewritten fresh every
//     cycle (`multiSeatOfficialFilter`) with no running "consecutiveTerms"
//     field, and `CongressionalDistrict.holderCharacterId` is a
//     REDISTRICTING-only display projection (absent whenever redistricting is
//     off, which is most worlds) — not a resolver's source of truth.
//
// So this tracks tenure PER CANDIDATE IDENTITY (characterId/nppId), not per
// party and not per district: each party's returning nominee carries their
// OWN consecutive-term count, so a state that stays 5-3 Democratic-Republican
// for a decade fatigues each incumbent's PERSONAL stat edge individually,
// while a party that retains control by fielding a brand-new nominee applies
// NO fatigue to that fresh nominee's own (already-modest) influence/
// favorability — matching the single-seat guard above (an open seat / a
// different person running resets to "first term").
//
// Reading history back out of `electionVoteTallies` (the only persisted
// record, since `ElectedOfficial` rows don't survive past the current cycle)
// can't reuse `getElectionWinnerIdentity`'s argmax-vote test — multi-seat
// "winning" depends on the seat-allocation formula, not raw vote rank. Instead
// this reuses the exact vote-share GATE the real allocator applies before a
// candidate is eligible for a seat at all (`getMultiSeatMinShare("house")` —
// 20%): clearing it each cycle is treated as "held at least one seat" that
// cycle. That's a proxy, not an exact seat re-derivation, but it's the same
// signal the allocator itself uses to admit a candidate, and consecutive-term
// COUNTING only needs a boolean per cycle, not the seat total.

/** Bounds the historical walk-back: personalStatTenureRetention saturates at
 *  PERSONAL_STAT_TENURE_EROSION_MAX/PERSONAL_STAT_TENURE_EROSION_PER_TERM = 5
 *  terms beyond the first, so looking back further can never change the
 *  erosion applied — this just bounds the DB work for a race with a very long
 *  resolved history. Kept above that saturation point so a recalibration of
 *  either constant does not silently truncate the count. */
const MAX_HOUSE_TENURE_LOOKBACK = 12;

/**
 * Per-candidate consecutive-term counts for a US House race, keyed by THIS
 * CYCLE's candidateId (`ElectionCandidate._id.toString()`, matching
 * `EnrichedCandidate.candidateId`) — one entry per still-running candidate
 * identity that held a seat (cleared the multi-seat vote-share gate) last
 * cycle, walking further back while the same identity keeps clearing it.
 * Absent from the map ⇒ first term / new nominee / open district ⇒ the
 * caller applies no fatigue (see the module doc comment above for why this
 * differs in shape from `resolveSingleSeatLegislativeIncumbent`).
 *
 * `runningIdentityToCandidateId` maps this cycle's candidate identities
 * (characterId/nppId `.toString()`) to their `ElectionCandidate._id.toString()`
 * — the caller already has both from the same `candidates` array used to
 * resolve the single-seat case.
 */
export async function resolveHouseIncumbentTenures(
  election: Election,
  runningIdentityToCandidateId: Map<string, string>,
  db: Db
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (election.electionType !== "house" || runningIdentityToCandidateId.size === 0) {
    return result;
  }

  const countryId = election.countryId ?? "US";
  const seatKey = getElectionSeatKey(election);
  const allResolved = await db
    .collection<Election>("elections")
    .find({ countryId, state: election.state, status: "resolved" })
    .toArray();
  const priorsOnSeat = allResolved
    .filter((p) => p.cycle < election.cycle && getElectionSeatKey(p) === seatKey)
    .sort((a, b) => b.cycle - a.cycle)
    .slice(0, MAX_HOUSE_TENURE_LOOKBACK);
  if (priorsOnSeat.length === 0) return result;

  const minShare = getMultiSeatMinShare("house");

  // Newest → oldest: for each prior cycle, which identities cleared the
  // multi-seat vote-share gate (a proxy for "held at least one seat").
  const clearedByCycle: Set<string>[] = [];
  for (const prior of priorsOnSeat) {
    const cleared = new Set<string>();
    const tally = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId: prior._id });
    if (tally?.finalized) {
      const totalVotes = Object.values(tally.totalVotes).reduce(
        (sum, v) => sum + (typeof v === "number" && Number.isFinite(v) ? v : 0),
        0
      );
      if (totalVotes > 0) {
        const priorCandidates = await db
          .collection<ElectionCandidate>("electionCandidates")
          .find({ electionId: prior._id })
          .toArray();
        for (const c of priorCandidates) {
          const identity = identityOf(c);
          if (!identity) continue;
          const votes = tally.totalVotes[c._id.toString()];
          if (typeof votes === "number" && votes / totalVotes >= minShare) {
            cleared.add(identity);
          }
        }
      }
    }
    clearedByCycle.push(cleared);
  }

  for (const [identity, candidateId] of runningIdentityToCandidateId) {
    let terms = 0;
    for (const cleared of clearedByCycle) {
      if (cleared.has(identity)) terms += 1;
      else break;
    }
    if (terms > 0) result.set(candidateId, terms);
  }

  return result;
}
