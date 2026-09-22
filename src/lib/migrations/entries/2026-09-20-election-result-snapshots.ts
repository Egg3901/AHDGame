import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Migration } from "../types";
import {
  buildResultsPayload,
  snapshotFromPayload,
} from "@/lib/elections/liveResults/buildResultsPayload";
import type { ElectionResultSnapshot } from "@/lib/db/types/electionResultSnapshot";
import type { Election, GameState } from "@/lib/db/types";

const ENDED = ["completed", "resolved"] as const;

/** Races per bulkWrite. Small enough that a failure loses little work. */
const BATCH = 50;

/** How many example rows a dry run prints before it stops listing. */
const DRY_RUN_SAMPLE = 20;

/**
 * Freeze the results of every race the game has already finished with.
 *
 * Until now an ended race was recomputed on every visit: the electoral-vote map
 * was rebuilt from `gameState.currentYear` and party names and colours were
 * read live. Both drift. Apportionment is era-gated, so a race from an earlier
 * decade was scored against a map that was never in force when it ran, and a
 * party that later renamed or wound up rewrote its own past.
 *
 * Each race is rebuilt with the apportionment year pinned to its OWN
 * `electionYear`, so what gets stored is the college that actually governed it.
 * A race with no `electionYear` falls back to the current year, which is the
 * same value it renders with today, so it is no worse off than before.
 *
 * Purely additive: a new collection, no existing document read-modified or
 * deleted. Rollback is `db.electionResultSnapshots.drop()` plus removing the
 * `migrationsRun` marker, because the results route falls back to live
 * computation whenever a snapshot is missing.
 */
export const migration: Migration = {
  id: "2026-09-20-election-result-snapshots",
  description:
    "Create electionResultSnapshots indexes and backfill a frozen result for every ended race.",
  idempotent: true,
  async execute(db: Db, ctx) {
    const snapshots = db.collection<ElectionResultSnapshot>("electionResultSnapshots");

    // Indexes FIRST, and before any write. The unique electionId index is what
    // makes the capture at resolution idempotent, and building it ahead of the
    // backfill means a half-finished run cannot leave duplicates behind for the
    // next run to trip on.
    if (!ctx.dryRun) {
      await snapshots.createIndex(
        { electionId: 1 },
        { unique: true, name: "election_result_snapshot_election" }
      );
      await snapshots.createIndex(
        { countryId: 1, electionType: 1, cycle: -1 },
        { name: "election_result_snapshot_history" }
      );
    }

    const gameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" } as never);
    const currentTurn = gameState?.currentTurn ?? 0;

    const ended = await db
      .collection<Election>("elections")
      .find({ status: { $in: ENDED } })
      .sort({ cycle: 1 })
      .toArray();

    // The live states collection only retains today's delegation sizes. Ended
    // House races retain the size each state actually elected in their year,
    // which lets an old presidential map survive one or many later censuses.
    const houseSeatsByYear = new Map<number, Record<string, number>>();
    for (const election of ended) {
      if (
        election.countryId !== "US" ||
        election.electionType !== "house" ||
        typeof election.electionYear !== "number" ||
        typeof election.totalSeats !== "number" ||
        election.totalSeats <= 0
      ) {
        continue;
      }
      const seats = houseSeatsByYear.get(election.electionYear) ?? {};
      seats[election.state] = election.totalSeats;
      houseSeatsByYear.set(election.electionYear, seats);
    }

    const already = new Set(
      (await snapshots.find({}).project<{ electionId: ObjectId }>({ electionId: 1 }).toArray()).map(
        (s) => s.electionId.toString()
      )
    );

    // Only a race that actually recorded votes has anything to freeze.
    const withTallies = new Set(
      (
        await db
          .collection("electionVoteTallies")
          .find({})
          .project<{ electionId: ObjectId }>({ electionId: 1 })
          .toArray()
      ).map((t) => t.electionId.toString())
    );

    const todo = ended.filter(
      (e) => !already.has(e._id.toString()) && withTallies.has(e._id.toString())
    );

    if (ctx.dryRun) {
      return {
        documentsScanned: ended.length,
        notes: [
          `Would write ${todo.length} snapshot(s) across ${ended.length} ended race(s).`,
          ...todo
            .slice(0, DRY_RUN_SAMPLE)
            .map(
              (e) =>
                `  ${e.countryId}/${e.electionType} cycle ${e.cycle} -> apportionment year ${
                  e.electionYear ?? "current"
                }`
            ),
        ],
      };
    }

    const now = new Date();
    let inserted = 0;
    const failures: string[] = [];

    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const ops = [];
      for (const election of batch) {
        try {
          const payload = await buildResultsPayload(db, election, gameState, {
            // The map and allocation rules in force when the race ran, not
            // the ones in force today.
            apportionmentYear: election.electionYear ?? null,
            ...(election.countryId === "US" &&
            election.electionType === "president" &&
            election.electionYear !== undefined
              ? { houseSeatsByState: houseSeatsByYear.get(election.electionYear) }
              : {}),
            isAdmin: false,
          });
          const document = {
            _id: new ObjectId(),
            ...snapshotFromPayload(payload, election, currentTurn, now),
          } as ElectionResultSnapshot;
          ops.push({
            updateOne: {
              filter: { electionId: election._id },
              update: { $setOnInsert: document },
              upsert: true,
            },
          });
        } catch (err) {
          // One unreadable tally must not cost the other few hundred races
          // their snapshot. Named in the notes so it can be chased afterwards.
          failures.push(`${election._id.toString()}: ${(err as Error).message}`);
        }
      }
      if (ops.length > 0) {
        // Upsert + $setOnInsert makes a concurrent capture a clean no-op rather
        // than a duplicate-key BulkWriteError. ordered:false still lets
        // independent rows proceed when Mongo rejects one malformed operation.
        const res = await snapshots.bulkWrite(ops, { ordered: false });
        inserted += res.upsertedCount ?? 0;
      }
    }

    return {
      documentsScanned: ended.length,
      documentsInserted: inserted,
      notes: [
        "Created or verified electionResultSnapshots indexes.",
        `Backfilled ${inserted} snapshot(s) across ${ended.length} ended race(s).`,
        ...(failures.length > 0
          ? [`Skipped ${failures.length} that could not be rebuilt:`, ...failures]
          : []),
      ],
    };
  },
};
