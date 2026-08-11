/**
 * Backfill `playerEndorsements.candidateId` from the pre-#868 format
 * (character/NPP identity id) to the post-#868 format (electionCandidates
 * row _id).
 *
 *   npx tsx scripts/backfill-player-endorsement-candidate-ids.ts            # dry-run (report only)
 *   npx tsx scripts/backfill-player-endorsement-candidate-ids.ts --apply    # write
 *
 * PR #2507 changed POST/DELETE /api/elections/[id]/endorse to write
 * candidateId as the electionCandidates row _id instead of the candidate's
 * characterId, and a follow-up PR normalized every reader (primary page,
 * campaign action counts, general-election panel, candidate enrichment,
 * name-change propagation) onto that same row-id key. Documents written
 * before #2507 merged still have the old characterId-shaped candidateId,
 * so they now silently fail to join anywhere.
 *
 * Only `isActive: true` documents matter — every consumer filters on that,
 * so withdrawn/inactive endorsements are left untouched.
 *
 * For each active playerEndorsement, resolve the electionCandidates row for
 * (electionId, characterId: candidateId). If found and the row's own _id
 * differs from the stored candidateId, rewrite it. Prefers an active row,
 * falling back to any row for that identity (covers a candidate who
 * withdrew after being endorsed).
 *
 * Idempotent: a document already keyed by row id has no matching
 * electionCandidates row under `characterId`, so it's left alone.
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

interface PlayerEndorsementRow {
  _id: ObjectId;
  characterId: ObjectId;
  electionId: ObjectId;
  candidateId: ObjectId;
  candidateName: string;
  isActive: boolean;
}

interface ElectionCandidateRow {
  _id: ObjectId;
  electionId: ObjectId;
  characterId: ObjectId;
  status: string;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const apply = hasFlag("apply");
  const uri = process.env.MONGODB_URI_LIVE ?? process.env.MONGODB_URI;
  if (!uri) throw new Error("Neither MONGODB_URI_LIVE nor MONGODB_URI set in .env.local");

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();

    const activeEndorsements = await db
      .collection<PlayerEndorsementRow>("playerEndorsements")
      .find({ isActive: true })
      .toArray();

    const electionIds = [...new Set(activeEndorsements.map((e) => e.electionId.toString()))].map(
      (s) => new ObjectId(s)
    );
    const candidateRows = await db
      .collection<ElectionCandidateRow>("electionCandidates")
      .find({ electionId: { $in: electionIds } })
      .toArray();
    const rowsByElectionAndIdentity = new Map<string, ElectionCandidateRow[]>();
    for (const row of candidateRows) {
      const key = `${row.electionId.toString()}:${row.characterId.toString()}`;
      const list = rowsByElectionAndIdentity.get(key) ?? [];
      list.push(row);
      rowsByElectionAndIdentity.set(key, list);
    }
    const rowIds = new Set(candidateRows.map((r) => r._id.toString()));

    let alreadyCorrect = 0;
    let toFix = 0;
    let unresolved = 0;

    for (const e of activeEndorsements) {
      if (rowIds.has(e.candidateId.toString())) {
        alreadyCorrect++;
        continue;
      }
      const identityKey = `${e.electionId.toString()}:${e.candidateId.toString()}`;
      const candidates = rowsByElectionAndIdentity.get(identityKey) ?? [];
      const target = candidates.find((r) => r.status === "active") ?? candidates[0];
      if (!target) {
        unresolved++;
        console.warn(
          `[unresolved] playerEndorsements/${e._id} — no electionCandidates row for ` +
            `election ${e.electionId} character ${e.candidateId} (candidate "${e.candidateName}")`
        );
        continue;
      }
      toFix++;
      console.log(
        `[fix] playerEndorsements/${e._id} — candidateId ${e.candidateId} -> ${target._id} ` +
          `(candidate "${e.candidateName}", row status "${target.status}")`
      );
      if (apply) {
        await db
          .collection("playerEndorsements")
          .updateOne({ _id: e._id }, { $set: { candidateId: target._id } });
      }
    }

    console.log(
      `\n${apply ? "APPLIED" : "DRY-RUN"}: ${activeEndorsements.length} active endorsement(s) scanned — ` +
        `${alreadyCorrect} already row-id, ${toFix} ${apply ? "fixed" : "would be fixed"}, ${unresolved} unresolved.`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
