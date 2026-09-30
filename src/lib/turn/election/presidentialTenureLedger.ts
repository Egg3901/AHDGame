/**
 * Consecutive-tenure ledger for the presidential (head-of-government) office.
 *
 * The game stores no term history — single-seat resolution deletes the prior
 * `electedOfficials` row, the election doc never flags a winner, and per-
 * character career history misses NPP-held terms. So we maintain an explicit
 * O(1) counter on `gameState.presidentialTenureByCountry`, updated each time a
 * presidential election resolves. Read by the economic referendum channel
 * (`economicReferendum.ts`), whose term-fatigue multiplier scales the
 * penalty side, and by `appealWeight`'s `personalStatTenureRetention`.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { GameState } from "@/lib/db/types/gameState";

type TenureEntry = { party: string; consecutiveTerms: number };

/**
 * Pure next-state for the tenure counter given the prior entry and the party
 * that just won. Same party (case-sensitive sequentialId match) extends the
 * streak; any other party (or first-ever record) resets to a fresh 1-term
 * streak. A missing / empty winning party leaves the ledger untouched (returns
 * the prior entry, or a defensive 1 when there was none).
 */
export function nextPresidentialTenure(
  prior: TenureEntry | undefined,
  winnerParty: string | undefined | null
): TenureEntry {
  if (!winnerParty) return prior ?? { party: "", consecutiveTerms: 1 };
  if (prior && prior.party === winnerParty) {
    return { party: winnerParty, consecutiveTerms: prior.consecutiveTerms + 1 };
  }
  return { party: winnerParty, consecutiveTerms: 1 };
}

/**
 * Persist the tenure update for `countryId` after a presidential resolution.
 * An election receipt and compare-and-set make partial seating retries safe.
 * The caller keeps seating pending until this write succeeds.
 */
export async function recordPresidentialTenure(
  db: Db,
  countryId: CountryId,
  winnerParty: string | undefined | null,
  electionId: string
): Promise<void> {
  if (!winnerParty) return;
  const collection = db.collection<GameState>("gameState");
  const path = `presidentialTenureByCountry.${countryId}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const gs = await collection.findOne(
      { _id: "current" },
      { projection: { presidentialTenureByCountry: 1 } }
    );
    if (!gs) throw new Error("Presidential tenure requires the current world record");
    const prior = gs.presidentialTenureByCountry?.[countryId];
    if (prior?.lastElectionId === electionId) return;
    const next = { ...nextPresidentialTenure(prior, winnerParty), lastElectionId: electionId };
    const result = await collection.updateOne(
      { _id: "current", [path]: prior ?? { $exists: false } },
      { $set: { [path]: next } }
    );
    if (result.matchedCount === 1) return;
  }
  throw new Error("Concurrent presidential tenure update did not settle");
}

/**
 * Consecutive terms the given party has held the presidency in `countryId`
 * (terms already won; the incumbent is seeking `+1`). Returns 0 unless the
 * stored ledger party matches `incumbentPartyId` — a party mismatch means the
 * counter tracks someone else's streak and no fatigue applies.
 */
export function getPresidentialConsecutiveTerms(
  gameState: Pick<GameState, "presidentialTenureByCountry"> | null | undefined,
  countryId: CountryId,
  incumbentPartyId: string | undefined
): number {
  if (!incumbentPartyId) return 0;
  const entry = gameState?.presidentialTenureByCountry?.[countryId];
  if (!entry || entry.party !== incumbentPartyId) return 0;
  return entry.consecutiveTerms;
}
