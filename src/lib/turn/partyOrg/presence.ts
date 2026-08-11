import type { Db } from "mongodb";
import type { Character, ElectedOfficial, StatePartyOrg, PartyBudget, NPP } from "@/lib/db/types";

/**
 * Check if a party has presence in a state.
 * Presence = at least 1 player character OR 1 elected official OR 1 active NPP.
 *
 * An NPP private citizen (a non-player politician who is a party member homed in
 * the state but holds no office) counts as presence — without this, a state whose
 * only party affiliation is NPPs is wrongly treated as empty, blocking Build Org
 * for the national chair / vice-chair / campaigner. Officials are still checked
 * separately because an NPP can hold office in a state other than its home state.
 *
 * @param db - Database connection
 * @param stateId - State to check
 * @param partyId - Party to check
 * @returns true if party has presence
 */
export async function checkPartyPresence(
  db: Db,
  stateId: string,
  partyId: string
): Promise<boolean> {
  // Check for player characters
  const playerCount = await db.collection<Character>("characters").countDocuments({
    party: partyId,
    homeState: stateId,
  });
  if (playerCount > 0) return true;

  // Check for elected officials (players and NPPs)
  const officialCount = await db.collection<ElectedOfficial>("electedOfficials").countDocuments({
    party: partyId,
    state: stateId,
  });
  if (officialCount > 0) return true;

  // Check for active (non-retired) NPPs homed in the state for this party.
  const nppCount = await db.collection<NPP>("npps").countDocuments({
    party: partyId,
    homeState: stateId,
    retiredAt: null,
  });
  if (nppCount > 0) return true;

  return false;
}

/**
 * Update the presence flag for a state party and reset org budget if presence lost.
 *
 * @param db - Database connection
 * @param stateId - State to update
 * @param partyId - Party to update
 */
export async function updatePartyPresence(db: Db, stateId: string, partyId: string): Promise<void> {
  const key = `${stateId}_${partyId}`;
  const hasPresence = await checkPartyPresence(db, stateId, partyId);

  // Update presence flag
  await db
    .collection<StatePartyOrg>("statePartyOrg")
    .updateOne({ _id: key }, { $set: { hasPresence, updatedAt: new Date() } });

  // If presence lost, reset org building budget to 0
  if (!hasPresence) {
    await db
      .collection<PartyBudget>("partyBudget")
      .updateOne(
        { partyId, scope: "state", stateId },
        { $set: { orgBuildingPercent: 0, updatedAt: new Date() } }
      );

    console.log(`[Presence] ${partyId} lost presence in ${stateId}, org building reset to 0`);
  }
}
