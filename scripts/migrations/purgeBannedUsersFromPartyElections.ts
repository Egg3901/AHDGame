/**
 * One-time purge of banned users' party-leadership and committee footprint:
 *
 *   Election cleanup:
 *     - withdraw their active candidacies in `nationalPartyCandidates`,
 *       `statePartyCandidates`, and `nationalCommitteeCandidates`
 *     - delete their votes in `nationalPartyVotes`, `statePartyVotes`, and
 *       `nationalCommitteeVotes`
 *
 *   Seat vacation:
 *     - clear `politicalParties.{chair,viceChair,treasurer}Id` and pull from
 *       `politicalParties.committeeIds[]`
 *     - clear `statePartyOrg.{chair,viceChair,treasurer}Id`
 *     - clear `coalitions.chairCharacterId` (direct + cascade when their
 *       party loses its chair)
 *
 * Pairs with the ban-time `cleanupPartyElectionsForBannedUser` and
 * `vacatePartyLeadershipForBannedUser` helpers added in the
 * banned-players-fixes branch — those handle new bans going forward; this
 * script catches accounts banned BEFORE that code shipped (or banned via
 * direct DB edits that bypassed the admin route).
 *
 * Safe to re-run: every operation is idempotent — `updateMany` with
 * `status: "active"` no-ops once the documents are already withdrawn,
 * `deleteMany` no-ops once votes are already gone, and `$set` to null on an
 * already-null field is a no-op.
 *
 * Target DB: set MONGODB_URI_LIVE in .env.local.
 *
 * Usage:
 *   npx tsx scripts/migrations/purgeBannedUsersFromPartyElections.ts          # dry-run
 *   npx tsx scripts/migrations/purgeBannedUsersFromPartyElections.ts --apply  # writes changes
 */

import { MongoClient, type Db, type ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Character, PoliticalParty, StatePartyOrg, User } from "../../src/lib/db/types";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const apply = process.argv.includes("--apply");
const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE missing — set it in .env.local");
  process.exit(1);
}

interface PurgeCounts {
  bannedUsers: number;
  bannedCharacters: number;
  nationalPartyCandidatesWithdrawn: number;
  nationalPartyVotesDeleted: number;
  statePartyCandidatesWithdrawn: number;
  statePartyVotesDeleted: number;
  committeeCandidatesWithdrawn: number;
  committeeVotesDeleted: number;
  nationalChairsVacated: number;
  nationalViceChairsVacated: number;
  nationalTreasurersVacated: number;
  committeeSeatsVacated: number;
  stateChairsVacated: number;
  stateViceChairsVacated: number;
  stateTreasurersVacated: number;
  coalitionChairsCleared: number;
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db: Db = client.db("a-house-divided");
  console.log(`Connected. Mode = ${apply ? "APPLY (writes)" : "DRY-RUN"}`);

  const counts: PurgeCounts = {
    bannedUsers: 0,
    bannedCharacters: 0,
    nationalPartyCandidatesWithdrawn: 0,
    nationalPartyVotesDeleted: 0,
    statePartyCandidatesWithdrawn: 0,
    statePartyVotesDeleted: 0,
    committeeCandidatesWithdrawn: 0,
    committeeVotesDeleted: 0,
    nationalChairsVacated: 0,
    nationalViceChairsVacated: 0,
    nationalTreasurersVacated: 0,
    committeeSeatsVacated: 0,
    stateChairsVacated: 0,
    stateViceChairsVacated: 0,
    stateTreasurersVacated: 0,
    coalitionChairsCleared: 0,
  };

  const bannedUsers = await db
    .collection<User>("users")
    .find({ isBanned: true })
    .project<{ _id: ObjectId; username: string }>({ _id: 1, username: 1 })
    .toArray();
  counts.bannedUsers = bannedUsers.length;

  if (bannedUsers.length === 0) {
    console.log("No banned users found — nothing to purge.");
    await client.close();
    return;
  }

  console.log(
    `Banned users (${bannedUsers.length}): ${bannedUsers.map((u) => u.username).join(", ")}`
  );

  const userIds = bannedUsers.map((u) => u._id);
  const characters = await db
    .collection<Character>("characters")
    .find({ userId: { $in: userIds } })
    .project<{ _id: ObjectId; name: string; userId: ObjectId }>({ _id: 1, name: 1, userId: 1 })
    .toArray();
  counts.bannedCharacters = characters.length;

  if (characters.length === 0) {
    console.log("Banned users have no characters — nothing to purge.");
    await client.close();
    return;
  }

  console.log(
    `Banned characters (${characters.length}): ${characters.map((c) => c.name).join(", ")}`
  );

  const characterIds = characters.map((c) => c._id);
  const now = new Date();

  // Probe counts so dry-run reports the would-be impact.
  counts.nationalPartyCandidatesWithdrawn = await db
    .collection("nationalPartyCandidates")
    .countDocuments({ characterId: { $in: characterIds }, status: "active" });
  counts.nationalPartyVotesDeleted = await db
    .collection("nationalPartyVotes")
    .countDocuments({ voterId: { $in: characterIds } });
  counts.statePartyCandidatesWithdrawn = await db
    .collection("statePartyCandidates")
    .countDocuments({ characterId: { $in: characterIds }, status: "active" });
  counts.statePartyVotesDeleted = await db
    .collection("statePartyVotes")
    .countDocuments({ voterId: { $in: characterIds } });
  counts.committeeCandidatesWithdrawn = await db
    .collection("nationalCommitteeCandidates")
    .countDocuments({ characterId: { $in: characterIds }, status: "active" });
  counts.committeeVotesDeleted = await db
    .collection("nationalCommitteeVotes")
    .countDocuments({ voterId: { $in: characterIds } });

  if (apply) {
    const npcRes = await db
      .collection("nationalPartyCandidates")
      .updateMany(
        { characterId: { $in: characterIds }, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
    counts.nationalPartyCandidatesWithdrawn = npcRes.modifiedCount;

    const npvRes = await db
      .collection("nationalPartyVotes")
      .deleteMany({ voterId: { $in: characterIds } });
    counts.nationalPartyVotesDeleted = npvRes.deletedCount;

    const spcRes = await db
      .collection("statePartyCandidates")
      .updateMany(
        { characterId: { $in: characterIds }, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
    counts.statePartyCandidatesWithdrawn = spcRes.modifiedCount;

    const spvRes = await db
      .collection("statePartyVotes")
      .deleteMany({ voterId: { $in: characterIds } });
    counts.statePartyVotesDeleted = spvRes.deletedCount;

    const nccRes = await db
      .collection("nationalCommitteeCandidates")
      .updateMany(
        { characterId: { $in: characterIds }, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
    counts.committeeCandidatesWithdrawn = nccRes.modifiedCount;

    const ncvRes = await db
      .collection("nationalCommitteeVotes")
      .deleteMany({ voterId: { $in: characterIds } });
    counts.committeeVotesDeleted = ncvRes.deletedCount;
  }

  // ── Seat vacation pass ────────────────────────────────────────────────────
  // Find every party doc where one of these characters holds a seat, plus
  // every statePartyOrg doc. We walk in JS rather than batch updates so the
  // dry-run count is accurate per-position.
  const partyDocs = await db
    .collection<PoliticalParty>("politicalParties")
    .find({
      $or: [
        { chairId: { $in: characterIds } },
        { viceChairId: { $in: characterIds } },
        { treasurerId: { $in: characterIds } },
        { committeeIds: { $in: characterIds } },
      ],
    })
    .toArray();

  const characterIdSet = new Set(characterIds.map((id) => id.toString()));
  const partiesLosingChair: ObjectId[] = [];

  for (const party of partyDocs) {
    const setOps: Record<string, unknown> = { updatedAt: now };
    let touched = false;

    if (party.chairId && characterIdSet.has(party.chairId.toString())) {
      setOps.chairId = null;
      counts.nationalChairsVacated += 1;
      partiesLosingChair.push(party._id);
      touched = true;
    }
    if (party.viceChairId && characterIdSet.has(party.viceChairId.toString())) {
      setOps.viceChairId = null;
      counts.nationalViceChairsVacated += 1;
      touched = true;
    }
    if (party.treasurerId && characterIdSet.has(party.treasurerId.toString())) {
      setOps.treasurerId = null;
      counts.nationalTreasurersVacated += 1;
      touched = true;
    }

    const seatedCommittee = (party.committeeIds ?? []).filter((id) =>
      characterIdSet.has(id.toString())
    );

    const updateOp: Record<string, unknown> = {};
    if (touched) updateOp.$set = setOps;
    if (seatedCommittee.length > 0) {
      updateOp.$pull = { committeeIds: { $in: seatedCommittee } };
      counts.committeeSeatsVacated += seatedCommittee.length;
      if (!updateOp.$set) updateOp.$set = { updatedAt: now };
    }

    if (apply && Object.keys(updateOp).length > 0) {
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id }, updateOp);
    }
  }

  const stateOrgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({
      $or: [
        { chairId: { $in: characterIds } },
        { viceChairId: { $in: characterIds } },
        { treasurerId: { $in: characterIds } },
      ],
    })
    .toArray();

  for (const org of stateOrgs) {
    const setOps: Record<string, unknown> = { updatedAt: now };
    let touched = false;

    if (org.chairId && characterIdSet.has(org.chairId.toString())) {
      setOps.chairId = null;
      counts.stateChairsVacated += 1;
      touched = true;
    }
    if (org.viceChairId && characterIdSet.has(org.viceChairId.toString())) {
      setOps.viceChairId = null;
      counts.stateViceChairsVacated += 1;
      touched = true;
    }
    if (org.treasurerId && characterIdSet.has(org.treasurerId.toString())) {
      setOps.treasurerId = null;
      counts.stateTreasurersVacated += 1;
      touched = true;
    }

    if (apply && touched) {
      await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne({ _id: org._id }, { $set: setOps });
    }
  }

  // Coalitions: direct chair hold + cascade for parties that just lost a chair.
  const directCoalitionMatch = { chairCharacterId: { $in: characterIds } };
  const directCoalitionCount = await db
    .collection("coalitions")
    .countDocuments(directCoalitionMatch);
  counts.coalitionChairsCleared += directCoalitionCount;

  if (apply && directCoalitionCount > 0) {
    await db
      .collection("coalitions")
      .updateMany(directCoalitionMatch, { $set: { chairCharacterId: null, updatedAt: now } });
  }

  if (partiesLosingChair.length > 0) {
    const cascadeMatch = { chairPartyId: { $in: partiesLosingChair } };
    const cascadeCount = await db.collection("coalitions").countDocuments(cascadeMatch);
    counts.coalitionChairsCleared += cascadeCount;
    if (apply && cascadeCount > 0) {
      await db
        .collection("coalitions")
        .updateMany(cascadeMatch, { $set: { chairCharacterId: null, updatedAt: now } });
    }
  }

  console.log("\n==== Purge summary ====");
  console.log(`  Banned users:                          ${counts.bannedUsers}`);
  console.log(`  Banned characters:                     ${counts.bannedCharacters}`);
  console.log(
    `  nationalPartyCandidates withdrawn:     ${counts.nationalPartyCandidatesWithdrawn}`
  );
  console.log(`  nationalPartyVotes deleted:            ${counts.nationalPartyVotesDeleted}`);
  console.log(`  statePartyCandidates withdrawn:        ${counts.statePartyCandidatesWithdrawn}`);
  console.log(`  statePartyVotes deleted:               ${counts.statePartyVotesDeleted}`);
  console.log(`  nationalCommitteeCandidates withdrawn: ${counts.committeeCandidatesWithdrawn}`);
  console.log(`  nationalCommitteeVotes deleted:        ${counts.committeeVotesDeleted}`);
  console.log(`  national chairs vacated:               ${counts.nationalChairsVacated}`);
  console.log(`  national vice chairs vacated:          ${counts.nationalViceChairsVacated}`);
  console.log(`  national treasurers vacated:           ${counts.nationalTreasurersVacated}`);
  console.log(`  committee seats vacated:               ${counts.committeeSeatsVacated}`);
  console.log(`  state chairs vacated:                  ${counts.stateChairsVacated}`);
  console.log(`  state vice chairs vacated:             ${counts.stateViceChairsVacated}`);
  console.log(`  state treasurers vacated:              ${counts.stateTreasurersVacated}`);
  console.log(`  coalition chair pointers cleared:      ${counts.coalitionChairsCleared}`);

  if (!apply) {
    console.log(`\nRe-run with --apply to write these changes.`);
  }

  await client.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
