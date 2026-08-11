/**
 * Backfill turn-number deadline fields on game-time-anchored docs that
 * pre-date the turn-number migration.
 *
 * Affected collections + fields:
 *   - bills:              votingEndsOnTurn, otherChamberVotingEndsOnTurn,
 *                         presidentActionDeadlineOnTurn, overrideVotingEndsOnTurn
 *   - stateBills:         votingEndsOnTurn, governorActionDeadlineOnTurn,
 *                         overrideVotingEndsOnTurn
 *   - cabinetNominations: votingEndsOnTurn
 *   - coalitions:         disbandVote.expiresOnTurn,
 *                         priorities[*].expiresOnTurn (for leadership goals)
 *
 * For each missing turn field, compute the equivalent turn from
 *   turn = currentTurn + Math.round((deadlineMs - lastTurnProcessedMs) / MS_PER_TURN)
 *
 * Usage
 * -----
 *   npx tsx scripts/migrations/2026-05-20-backfill-deadline-turn-numbers.ts          # dry-run
 *   npx tsx scripts/migrations/2026-05-20-backfill-deadline-turn-numbers.ts --apply  # commit
 */
import { MongoClient, type ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) throw new Error("MONGODB_URI_LIVE must be set in .env.local");
const APPLY = process.argv.includes("--apply");

const MS_PER_TURN = 60 * 60 * 1000; // 1 turn = 1 hour real time

function turnFor(deadline: Date, currentTurn: number, lastTurnProcessed: Date): number {
  const deltaMs = deadline.getTime() - lastTurnProcessed.getTime();
  return currentTurn + Math.round(deltaMs / MS_PER_TURN);
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  console.log(APPLY ? "=== APPLY MODE ===" : "=== DRY RUN ===");
  try {
    const db = client.db("a-house-divided");
    const gs = (await db
      .collection("gameState")
      .findOne({ _id: "current" as unknown as never })) as {
      currentTurn?: number;
      lastTurnProcessed?: Date;
    } | null;
    if (!gs?.currentTurn || !gs.lastTurnProcessed) {
      throw new Error("gameState.currentTurn or lastTurnProcessed missing");
    }
    const currentTurn = gs.currentTurn as number;
    const ltp = new Date(gs.lastTurnProcessed as Date);
    console.log(`Reference: currentTurn=${currentTurn} lastTurnProcessed=${ltp.toISOString()}`);

    // ── bills ──────────────────────────────────────────────────────────────
    const billOps: Array<{
      updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, number> } };
    }> = [];
    const bills = await db
      .collection("bills")
      .find({
        $or: [
          { votingEndsAt: { $exists: true }, votingEndsOnTurn: { $exists: false } },
          {
            otherChamberVotingEndsAt: { $exists: true },
            otherChamberVotingEndsOnTurn: { $exists: false },
          },
          {
            presidentActionDeadline: { $exists: true },
            presidentActionDeadlineOnTurn: { $exists: false },
          },
          { overrideVotingEndsAt: { $exists: true }, overrideVotingEndsOnTurn: { $exists: false } },
        ],
      })
      .project({
        _id: 1,
        votingEndsAt: 1,
        votingEndsOnTurn: 1,
        otherChamberVotingEndsAt: 1,
        otherChamberVotingEndsOnTurn: 1,
        presidentActionDeadline: 1,
        presidentActionDeadlineOnTurn: 1,
        overrideVotingEndsAt: 1,
        overrideVotingEndsOnTurn: 1,
      })
      .toArray();
    for (const b of bills) {
      const set: Record<string, number> = {};
      if (b.votingEndsAt && b.votingEndsOnTurn == null) {
        set.votingEndsOnTurn = turnFor(new Date(b.votingEndsAt), currentTurn, ltp);
      }
      if (b.otherChamberVotingEndsAt && b.otherChamberVotingEndsOnTurn == null) {
        set.otherChamberVotingEndsOnTurn = turnFor(
          new Date(b.otherChamberVotingEndsAt),
          currentTurn,
          ltp
        );
      }
      if (b.presidentActionDeadline && b.presidentActionDeadlineOnTurn == null) {
        set.presidentActionDeadlineOnTurn = turnFor(
          new Date(b.presidentActionDeadline),
          currentTurn,
          ltp
        );
      }
      if (b.overrideVotingEndsAt && b.overrideVotingEndsOnTurn == null) {
        set.overrideVotingEndsOnTurn = turnFor(new Date(b.overrideVotingEndsAt), currentTurn, ltp);
      }
      if (Object.keys(set).length > 0) {
        billOps.push({ updateOne: { filter: { _id: b._id }, update: { $set: set } } });
      }
    }
    console.log(`bills: ${billOps.length} docs to backfill`);

    // ── stateBills ─────────────────────────────────────────────────────────
    const stateBillOps: Array<{
      updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, number> } };
    }> = [];
    const stateBills = await db
      .collection("stateBills")
      .find({
        $or: [
          { votingEndsAt: { $exists: true }, votingEndsOnTurn: { $exists: false } },
          {
            governorActionDeadline: { $exists: true },
            governorActionDeadlineOnTurn: { $exists: false },
          },
          { overrideVotingEndsAt: { $exists: true }, overrideVotingEndsOnTurn: { $exists: false } },
        ],
      })
      .project({
        _id: 1,
        votingEndsAt: 1,
        votingEndsOnTurn: 1,
        governorActionDeadline: 1,
        governorActionDeadlineOnTurn: 1,
        overrideVotingEndsAt: 1,
        overrideVotingEndsOnTurn: 1,
      })
      .toArray();
    for (const b of stateBills) {
      const set: Record<string, number> = {};
      if (b.votingEndsAt && b.votingEndsOnTurn == null) {
        set.votingEndsOnTurn = turnFor(new Date(b.votingEndsAt), currentTurn, ltp);
      }
      if (b.governorActionDeadline && b.governorActionDeadlineOnTurn == null) {
        set.governorActionDeadlineOnTurn = turnFor(
          new Date(b.governorActionDeadline),
          currentTurn,
          ltp
        );
      }
      if (b.overrideVotingEndsAt && b.overrideVotingEndsOnTurn == null) {
        set.overrideVotingEndsOnTurn = turnFor(new Date(b.overrideVotingEndsAt), currentTurn, ltp);
      }
      if (Object.keys(set).length > 0) {
        stateBillOps.push({ updateOne: { filter: { _id: b._id }, update: { $set: set } } });
      }
    }
    console.log(`stateBills: ${stateBillOps.length} docs to backfill`);

    // ── cabinetNominations ─────────────────────────────────────────────────
    const nominationOps: Array<{
      updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, number> } };
    }> = [];
    const nominations = await db
      .collection("cabinetNominations")
      .find({
        votingEndsAt: { $exists: true },
        votingEndsOnTurn: { $exists: false },
      })
      .project({ _id: 1, votingEndsAt: 1 })
      .toArray();
    for (const n of nominations) {
      if (!n.votingEndsAt) continue;
      nominationOps.push({
        updateOne: {
          filter: { _id: n._id },
          update: {
            $set: {
              votingEndsOnTurn: turnFor(new Date(n.votingEndsAt), currentTurn, ltp),
            },
          },
        },
      });
    }
    console.log(`cabinetNominations: ${nominationOps.length} docs to backfill`);

    // ── coalitions (disband + priorities) ──────────────────────────────────
    const coalitionOps: Array<{
      updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
    }> = [];
    const coalitions = await db
      .collection("coalitions")
      .find({
        $or: [
          {
            "disbandVote.expiresAt": { $exists: true },
            "disbandVote.expiresOnTurn": { $exists: false },
          },
          { priorities: { $elemMatch: { expiresAt: { $exists: true }, expiresOnTurn: null } } },
          {
            priorities: { $elemMatch: { expiresAt: { $exists: true }, expiresOnTurn: undefined } },
          },
        ],
      })
      .project({ _id: 1, disbandVote: 1, priorities: 1 })
      .toArray();
    for (const c of coalitions) {
      const set: Record<string, unknown> = {};
      if (c.disbandVote && c.disbandVote.expiresAt && c.disbandVote.expiresOnTurn == null) {
        set["disbandVote.expiresOnTurn"] = turnFor(
          new Date(c.disbandVote.expiresAt),
          currentTurn,
          ltp
        );
      }
      if (Array.isArray(c.priorities)) {
        const updatedPriorities = c.priorities.map(
          (p: { expiresAt?: Date; expiresOnTurn?: number | null }) => {
            if (p && p.expiresAt && p.expiresOnTurn == null) {
              return {
                ...p,
                expiresOnTurn: turnFor(new Date(p.expiresAt), currentTurn, ltp),
              };
            }
            return p;
          }
        );
        // Only write priorities if something actually changed
        const changed = updatedPriorities.some((p, idx) => p !== c.priorities[idx]);
        if (changed) set.priorities = updatedPriorities;
      }
      if (Object.keys(set).length > 0) {
        coalitionOps.push({ updateOne: { filter: { _id: c._id }, update: { $set: set } } });
      }
    }
    console.log(`coalitions: ${coalitionOps.length} docs to backfill`);

    // ── apply ──────────────────────────────────────────────────────────────
    if (!APPLY) {
      console.log("\n[DRY RUN] no writes performed.");
      return;
    }
    if (billOps.length > 0) {
      const r = await db.collection("bills").bulkWrite(billOps);
      console.log(`bills bulkWrite: matched=${r.matchedCount} modified=${r.modifiedCount}`);
    }
    if (stateBillOps.length > 0) {
      const r = await db.collection("stateBills").bulkWrite(stateBillOps);
      console.log(`stateBills bulkWrite: matched=${r.matchedCount} modified=${r.modifiedCount}`);
    }
    if (nominationOps.length > 0) {
      const r = await db.collection("cabinetNominations").bulkWrite(nominationOps);
      console.log(
        `cabinetNominations bulkWrite: matched=${r.matchedCount} modified=${r.modifiedCount}`
      );
    }
    if (coalitionOps.length > 0) {
      const r = await db.collection("coalitions").bulkWrite(coalitionOps);
      console.log(`coalitions bulkWrite: matched=${r.matchedCount} modified=${r.modifiedCount}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
