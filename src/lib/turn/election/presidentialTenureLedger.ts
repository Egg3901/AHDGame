/**
 * Consecutive-tenure ledger for the presidential (head-of-government) office.
 *
 * The game stores no term history — single-seat resolution deletes the prior
 * `electedOfficials` row, the election doc never flags a winner, and per-
 * character career history misses NPP-held terms. So we maintain an explicit
 * O(1) counter on `gameState.presidentialTenureByCountry`, updated each time a
 * presidential election resolves. Read by the economic referendum channel
 * (`economicReferendum.ts`), whose term-fatigue multiplier scales the
 * penalty side, and by `appealWeight`'s `personalStatTenureFatigue`.
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
 * No-op on a missing winning party. Best-effort — callers should not fail the
 * resolution if this throws.
 */
export async function recordPresidentialTenure(
  db: Db,
  countryId: CountryId,
  winnerParty: string | undefined | null
): Promise<void> {
  if (!winnerParty) return;
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { presidentialTenureByCountry: 1 } });
  const prior = gs?.presidentialTenureByCountry?.[countryId];
  const next = nextPresidentialTenure(prior, winnerParty);
  await db
    .collection<GameState>("gameState")
    .updateOne(
      { _id: "current" },
      { $set: { [`presidentialTenureByCountry.${countryId}`]: next } }
    );
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
