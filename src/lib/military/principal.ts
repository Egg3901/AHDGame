import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { CountryId } from "@/lib/constants/countries";
import type { Side } from "./occupation";

/**
 * Turns a victor has to name their terms before the window lapses.
 *
 * Long enough that a player who is not logged in when the front breaks still gets
 * to answer for it, short enough that a won war does not sit unresolved. Shorter
 * than `PEACE_OFFER_DURATION_TURNS` on purpose: an offer waits on another player,
 * while this waits only on the winner.
 *
 * BALANCE CONSTANT. Changing it needs an issue and a simulation report.
 */
export const DICTATE_WINDOW_TURNS = 24;

/**
 * The founding belligerent of one side, or null when the side has none.
 *
 * A guest is any country that did not start this war on this side, and there are TWO
 * ways to be one:
 *
 *   - A JOIN STAMP. `joinTurns` records every country that entered after the war
 *     opened, as its own comment states: "Founding belligerents are absent and fall
 *     back to `startTurn` / `controlStart`."
 *   - A TREATY ENTRY. A war CREATED with treaty defenders never stamps them:
 *     `declareWar` resolves them BEFORE `createConflict`, because they drive
 *     `initialControl`, `deployOpeningForces` and `baseStrength`, so `joinSide`
 *     never runs for them. Read by `joinTurns` alone a dragged-in ally looks like a
 *     founder. The live War for Germany is exactly this shape: Russia was pulled in
 *     under the Warsaw Pact and carries no join stamp at all.
 *
 * Both are checked. Reading only the first happened to give the right answer today
 * because `createConflict` writes `countries: [defender, ...defenders]`, so the
 * founder is first in the array. That array order is not a stated contract, and a
 * rule this load-bearing should not rest on it.
 *
 * WHY THE PRINCIPAL AND NOT THE WHOLE SIDE. A coalition victory must yield ONE
 * term, not one per ally, or "pick one" stops meaning anything. The country that
 * started the war is the one with the claim; allies pulled in behind it get the
 * truce, matching how `treatyEntries` already treats them as guests in someone
 * else's war.
 *
 * Null in two cases the caller must handle by resolving the war outright:
 *   - An EMPTY roster, which is a generated side with no government to address.
 *   - Every country carrying a join stamp, which happens once the founder has
 *     taken a separate peace. Handing its claim to a late joiner would award the
 *     war to a country that did not start it.
 */
export function principalOf(
  // A Pick rather than the whole document, so the offer validator and the offer form
  // can ask the same question without holding a fully loaded conflict.
  conflict: Pick<ConflictDoc, "sideA" | "sideB" | "joinTurns" | "treatyEntries">,
  side: Side
): CountryId | null {
  const roster = side === "A" ? conflict.sideA.countries : conflict.sideB.countries;
  if (roster.length === 0) return null;
  const guests = new Set<string>([
    ...(conflict.joinTurns ?? []).map((j) => j.countryId),
    ...(conflict.treatyEntries ?? []).map((e) => e.countryId),
  ]);
  // Roster order, which is stable: the array is only ever appended to and spliced,
  // never reordered, so a side with several founders names the same one every time.
  return roster.find((c) => !guests.has(c)) ?? null;
}
