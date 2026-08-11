// src/lib/turn/npp/leadershipVoting.ts
/**
 * NPP Leadership Voting
 *
 * Houses the shared helpers for leadership-style vote casting. The actual US
 * congressional leadership voting pass is intentionally disabled because those
 * elections are now player-only.
 */

import { type ObjectId, type Db } from "mongodb";
import type { NPP, PoliticalParty } from "@/lib/db/types";
import type { NPPContext } from "./context";
import { calculateComplianceChance } from "../nppVoteLogic";
import { resolveWhipForNPP } from "./whipResolution";
import { makeSeededRng } from "@/lib/events/substrate/rng";

// Optional sim-run salt, same convention as nppActionProcessing.ts's RNG.
const RNG_SALT = process.env.SIM_RNG_SALT ? `:${process.env.SIM_RNG_SALT}` : "";

/** Bonus when the nominee's party matches the NPP's party. */
export const PARTY_MATCH_BONUS = 80;

/** Bonus when the nominee is a real player (character), not an NPP. */
export const REAL_PLAYER_BONUS = 15;

/**
 * Ideological alignment score between two positions (0-100).
 * Both axes are -5 to +5; maximum delta per axis = 10.
 */
export function alignmentScore(aEcon: number, aSoc: number, bEcon: number, bSoc: number): number {
  return Math.max(0, 100 - Math.abs(aEcon - bEcon) * 5 - Math.abs(aSoc - bSoc) * 5);
}

/**
 * Determine whip compliance for speaker/leadership elections.
 * Returns the whip-directed nomination _id if the NPP complies, or null.
 *
 * Note: leadership election whips store `candidacyId` pointing to a nomination ObjectId.
 */
export function resolveLeadershipWhip(
  npp: NPP,
  whips: import("@/lib/db/types").BillWhip[],
  statePartyOrgs: Map<string, import("@/lib/db/types").StatePartyOrg>,
  chamber: "house" | "senate",
  partyByCompositeKey: Map<string, PoliticalParty>,
  partyCountries: Map<string, import("@/lib/constants/countries").CountryId[]>
): ObjectId | null {
  const applicableWhip = resolveWhipForNPP(npp, whips, statePartyOrgs, chamber, {
    partyByCompositeKey,
    partyCountries,
  });

  if (!applicableWhip?.candidacyId) return null;

  const complianceChance = calculateComplianceChance(npp);
  // Note: as of this writing resolveLeadershipWhip has no live caller
  // (processSpeakerVoting below is a deliberate no-op — US leadership
  // elections are player-only) — this Math.random() never actually fires
  // in turn processing today. Seeded anyway for the "never Math.random() in
  // turn paths" doctrine, in case this gets wired up again later.
  const rng = makeSeededRng(`leadershipWhip:${npp._id}:${applicableWhip.candidacyId}${RNG_SALT}`);
  return rng() < complianceChance ? applicableWhip.candidacyId : null;
}

/**
 * Cast a vote for a nomination (speaker or leadership style), handling
 * re-votes by removing any previous vote for a different candidate.
 * Returns true if a new vote was cast, false if already voted for this candidate.
 */
export async function castLeadershipVote(
  db: Db,
  collectionName: string,
  nominations: Array<{ _id: ObjectId; votes?: Record<string, string> }>,
  nppKey: string,
  bestId: ObjectId,
  now: Date
): Promise<boolean> {
  const previousNom = nominations.find((n) => n.votes?.[nppKey] && !n._id.equals(bestId));
  if (previousNom) {
    await db
      .collection(collectionName)
      .updateOne(
        { _id: previousNom._id },
        { $unset: { [`votes.${nppKey}`]: "" }, $inc: { votesFor: -1 }, $set: { updatedAt: now } }
      );
  }

  const targetNom = nominations.find((n) => n._id.equals(bestId));
  if (targetNom && !targetNom.votes?.[nppKey]) {
    await db.collection(collectionName).updateOne(
      { _id: bestId },
      {
        $set: { [`votes.${nppKey}`]: "for", status: "voting", updatedAt: now },
        $inc: { votesFor: 1 },
      }
    );
    return true;
  }
  return false;
}

export async function processSpeakerVoting(ctx: NPPContext): Promise<number> {
  void ctx;

  // US congressional leadership elections are player-only. Leaving this as a
  // deliberate no-op prevents turn processing from silently reintroducing NPP
  // votes after routes and admin actions stopped creating NPP candidacies.
  return 0;
}
