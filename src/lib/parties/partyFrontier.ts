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
 * Scope by region set AND country, accepting legacy rows without countryId.
 * Party sequentialIds and region IDs can both collide across countries, so
 * region scoping alone can import a foreign party's presence. The legacy
 * fallback keeps optional NPP/official country fields backward-compatible.
 * National offices without a state do not establish regional presence.
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
  const countryScope = { $or: [{ countryId }, { countryId: { $exists: false } }] };

  const [memberStates, officialStates, nppStates] = await Promise.all([
    db
      .collection<Character>("characters")
      .distinct("homeState", { ...countryScope, party: partyId, homeState: inCountry }),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .distinct("state", { ...countryScope, party: partyId, state: inCountry }),
    db.collection<NPP>("npps").distinct("homeState", {
      ...countryScope,
      party: partyId,
      retiredAt: null,
      homeState: inCountry,
    }),
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

/** Batch live presence for a country's parties without expanding adjacency. */
export async function getPartyPresenceMap(
  db: Db,
  countryId: CountryId,
  partyIds: string[]
): Promise<Map<string, Set<string>>> {
  if (partyIds.length === 0) return new Map();
  const regions = await getCountryRegionIds(db, countryId);
  const party = { $in: partyIds };
  const homeState = { $in: regions };
  const countryScope = { $or: [{ countryId }, { countryId: { $exists: false } }] };
  const [members, officials, npps] = await Promise.all([
    db
      .collection<Character>("characters")
      .find({ ...countryScope, party, homeState }, { projection: { party: 1, homeState: 1 } })
      .toArray(),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ ...countryScope, party, state: homeState }, { projection: { party: 1, state: 1 } })
      .toArray(),
    db
      .collection<NPP>("npps")
      .find(
        { ...countryScope, party, homeState, retiredAt: null },
        { projection: { party: 1, homeState: 1 } }
      )
      .toArray(),
  ]);
  const presence = new Map(partyIds.map((id) => [id, new Set<string>()]));
  for (const row of [...members, ...npps]) {
    if (row.homeState) presence.get(row.party)?.add(row.homeState);
  }
  for (const row of officials) {
    if (row.party && row.state) presence.get(row.party)?.add(row.state);
  }
  return presence;
}

/** Batch the same live-presence reads for the character creation party picker. */
export async function getPartyFrontiers(
  db: Db,
  countryId: CountryId,
  partyIds: string[]
): Promise<Map<string, string[] | null>> {
  const presence = await getPartyPresenceMap(db, countryId, partyIds);
  return new Map(
    [...presence].map(([id, states]) => [
      id,
      states.size === 0 ? null : [...expandFrontier(countryId, states)].sort(),
    ])
  );
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
