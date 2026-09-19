/**
 * Party growth frontier.
 *
 * A party may only grow into regions it already touches. The frontier is the
 * party's live presence set expanded by exactly one adjacency hop:
 *
 *   presence(P) = regions holding >=1 member, >=1 elected official, or
 *                 >=1 active NPP of P
 *   frontier(P) = presence(P) UNION neighbours(presence(P))
 *
 * Gates NPP recruitment, NPP relocation and player party-joining. Presence is
 * the same signal `checkPartyPresence` uses, so a recruited NPP extends the
 * frontier and a party expands outward one hop at a time.
 *
 * Presence is always read LIVE. Never gate on `statePartyOrg.hasPresence` —
 * that cached flag only refreshes on membership events and lags, which is the
 * same reason the Build Org foothold rule re-checks presence live.
 */
import type { Db } from "mongodb";
import { adjacentStates } from "@/lib/constants/stateAdjacency";
import type { Character, ElectedOfficial, NPP, PoliticalParty, State } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Expand a presence set by exactly one adjacency hop. Pure.
 *
 * A state with no entry in the country's adjacency map contributes only
 * itself — `adjacentStates` returns [] for both an unknown state and a
 * genuinely isolated one (US `HI`), and the two are indistinguishable here.
 */
export function expandFrontier(countryId: CountryId, presence: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const stateId of presence) {
    if (!stateId) continue;
    out.add(stateId);
    for (const neighbour of adjacentStates(countryId, stateId)) out.add(neighbour);
  }
  return out;
}

/**
 * The gate. Fails OPEN in two cases, both deliberate:
 *
 *   - Empty presence: a party with no members, officials or NPPs has no
 *     geography to violate. Gating it would make it permanently unjoinable and
 *     permanently dead. The first joiner re-anchors it.
 *   - No `stateId`: legacy/seed characters without a home state cannot be
 *     placed. Blocking would hard-lock them out of every party in the game.
 */
export function isInFrontier(
  presence: ReadonlySet<string>,
  frontier: ReadonlySet<string>,
  stateId: string | null | undefined
): boolean {
  if (presence.size === 0) return true;
  if (!stateId) return true;
  return frontier.has(stateId);
}

/** Every region `_id` belonging to `countryId`. */
export async function getCountryRegionIds(db: Db, countryId: CountryId): Promise<string[]> {
  const rows = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1 } })
    .toArray();
  return rows.map((r) => r._id);
}

/**
 * Live presence set for one party.
 *
 * Scoped by REGION SET, not by `countryId`: `NPP.countryId` and
 * `ElectedOfficial.countryId` are both optional, so a countryId filter would
 * silently drop legacy rows and wrongly shrink the frontier. Region scoping is
 * correct either way, and it also excludes national offices (president, prime
 * minister) that carry no `state`. It is load-bearing for correctness too —
 * party `sequentialId` is per-country, so party "1" exists in both the US and
 * the UK and an unscoped read would merge their presence.
 */
export async function getPartyPresenceStates(
  db: Db,
  countryId: CountryId,
  partyId: string,
  regionIds?: readonly string[]
): Promise<Set<string>> {
  const regions = regionIds ?? (await getCountryRegionIds(db, countryId));
  const regionSet = new Set(regions);
  const inCountry = { $in: [...regions] };

  const [memberStates, officialStates, nppStates] = await Promise.all([
    db
      .collection<Character>("characters")
      .distinct("homeState", { party: partyId, homeState: inCountry }),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .distinct("state", { party: partyId, state: inCountry }),
    db
      .collection<NPP>("npps")
      .distinct("homeState", { party: partyId, retiredAt: null, homeState: inCountry }),
  ]);

  const presence = new Set<string>();
  for (const value of [...memberStates, ...officialStates, ...nppStates]) {
    if (typeof value === "string" && regionSet.has(value)) presence.add(value);
  }
  return presence;
}

/** `{ presence, frontier }` for one party. */
export async function getPartyFrontier(
  db: Db,
  countryId: CountryId,
  partyId: string,
  regionIds?: readonly string[]
): Promise<{ presence: Set<string>; frontier: Set<string> }> {
  const presence = await getPartyPresenceStates(db, countryId, partyId, regionIds);
  return { presence, frontier: expandFrontier(countryId, presence) };
}

/**
 * Shared join guard.
 *
 * Lives here rather than inside `applyCharacterPartyJoin` because that function
 * documents that callers own the guards; both join routes call this so the two
 * paths cannot drift.
 */
export async function canCharacterJoinParty(
  db: Db,
  character: Pick<Character, "homeState">,
  party: Pick<PoliticalParty, "sequentialId" | "name">,
  countryId: CountryId
): Promise<{ ok: true } | { ok: false; error: string }> {
  const regionIds = await getCountryRegionIds(db, countryId);
  // Third fail-open case, alongside the two in `isInFrontier`. The recruitment
  // and relocation paths hand us a region they just proved exists in `states`;
  // a joiner's `homeState` is never validated that way, and regions do get
  // transferred, merged and dissolved. A character left homed in a region that
  // is no longer part of this country cannot be placed on the map at all, and
  // blocking would lock them out of every party in the game rather than just
  // the distant ones. Treat unplaceable the same as homeless: allow.
  if (character.homeState && !regionIds.includes(character.homeState)) {
    return { ok: true };
  }

  const { presence, frontier } = await getPartyFrontier(
    db,
    countryId,
    String(party.sequentialId),
    regionIds
  );
  if (isInFrontier(presence, frontier, character.homeState)) return { ok: true };
  return {
    ok: false,
    error: `${party.name} is not established in or next to your home region. You can only join a party that already has a presence nearby.`,
  };
}
