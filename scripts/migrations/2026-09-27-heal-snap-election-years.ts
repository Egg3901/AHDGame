/**
 * Dry-run-first repair for snap elections whose baked electionYear came from
 * canonical cycle math instead of the in-game year of their resolution turn.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-09-27-heal-snap-election-years.ts --live
 *   npx tsx scripts/migrations/2026-09-27-heal-snap-election-years.ts --live --env-file=C:\path\to\.env.local
 *   npx tsx scripts/migrations/2026-09-27-heal-snap-election-years.ts --live --apply
 *
 * The default target is MONGODB_URI. Pass --live to select MONGODB_URI_LIVE.
 * Nothing is written unless --apply is present.
 */
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient, type ObjectId } from "mongodb";
import { snapElectionResolutionYear } from "../../src/lib/turn/rules/snapElection";

const envFileArgument = process.argv.find((argument) => argument.startsWith("--env-file="));
const envFile = envFileArgument?.slice("--env-file=".length);
dotenv.config({
  path: envFile ? path.resolve(envFile) : path.resolve(process.cwd(), ".env.local"),
});

type SnapElectionRow = {
  _id: ObjectId;
  countryId: string;
  electionType: string;
  state: string;
  cycle: number;
  electionYear?: number;
  endTurn?: number;
  status: string;
};

type GameStateCalendarRow = {
  _id: string;
  startingYear?: number;
  preIterationTurns?: number;
  preIteration?: { active?: boolean };
};

function isValidTurn(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isValidNonNegativeTurnCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const useLive = args.has("--live");
  const apply = args.has("--apply");
  const uriKey = useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI";
  const uri = process.env[uriKey];
  if (!uri) throw new Error(`${uriKey} is not set`);

  const client = new MongoClient(uri, {
    directConnection: !uri.startsWith("mongodb+srv://"),
  });
  await client.connect();

  try {
    const db = client.db();
    const gameState = await db.collection<GameStateCalendarRow>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          startingYear: 1,
          preIterationTurns: 1,
          preIteration: 1,
        },
      }
    );
    const startingYear = gameState?.startingYear;
    if (!gameState || typeof startingYear !== "number" || !Number.isSafeInteger(startingYear)) {
      throw new Error("gameState.current is missing a valid integer startingYear");
    }
    if (
      gameState.preIterationTurns !== undefined &&
      !isValidNonNegativeTurnCount(gameState.preIterationTurns)
    ) {
      throw new Error("gameState.current has an invalid preIterationTurns value");
    }
    const preIterationTurns = gameState.preIterationTurns;
    const preIterationActive = gameState.preIteration?.active;
    const elections = await db
      .collection<SnapElectionRow>("elections")
      .find(
        {
          electionType: /^snap_/,
          endTurn: { $exists: true },
        },
        {
          projection: {
            countryId: 1,
            electionType: 1,
            state: 1,
            cycle: 1,
            electionYear: 1,
            endTurn: 1,
            status: 1,
          },
        }
      )
      .toArray();

    const invalidRows = elections.filter((election) => !isValidTurn(election.endTurn));
    const repairs = elections.flatMap((election) => {
      if (!isValidTurn(election.endTurn)) return [];
      const expectedYear = snapElectionResolutionYear(election.endTurn, {
        startingYear,
        preIterationActive,
        preIterationTurns,
      });
      return election.electionYear === expectedYear ? [] : [{ election, expectedYear }];
    });

    console.log(
      JSON.stringify(
        {
          target: useLive ? "live" : "local",
          mode: apply ? "apply" : "dry-run",
          scanned: elections.length,
          invalidRows: invalidRows.map((election) => ({
            countryId: election.countryId,
            electionType: election.electionType,
            state: election.state,
            cycle: election.cycle,
            endTurn: election.endTurn ?? null,
          })),
          repairs: repairs.map(({ election, expectedYear }) => ({
            countryId: election.countryId,
            electionType: election.electionType,
            state: election.state,
            cycle: election.cycle,
            status: election.status,
            endTurn: election.endTurn,
            fromYear: election.electionYear ?? null,
            toYear: expectedYear,
          })),
        },
        null,
        2
      )
    );

    if (invalidRows.length > 0) {
      throw new Error(
        `Refusing to continue: ${invalidRows.length} snap election row(s) have an invalid endTurn`
      );
    }
    if (!apply || repairs.length === 0) return;

    const result = await db.collection<SnapElectionRow>("elections").bulkWrite(
      repairs.map(({ election, expectedYear }) => ({
        updateOne: {
          filter: {
            _id: election._id,
            ...(election.electionYear === undefined
              ? { electionYear: { $exists: false } }
              : { electionYear: election.electionYear }),
            endTurn: election.endTurn,
          },
          update: { $set: { electionYear: expectedYear } },
        },
      })),
      { ordered: false }
    );

    const expectedById = new Map(
      repairs.map(({ election, expectedYear }) => [election._id.toString(), expectedYear])
    );
    const verifiedRows = await db
      .collection<SnapElectionRow>("elections")
      .find(
        { _id: { $in: repairs.map(({ election }) => election._id) } },
        { projection: { electionYear: 1 } }
      )
      .toArray();
    const actualById = new Map(
      verifiedRows.map((election) => [election._id.toString(), election.electionYear])
    );
    const unverified = [...expectedById].filter(
      ([id, expectedYear]) => actualById.get(id) !== expectedYear
    );
    if (unverified.length > 0) {
      throw new Error(
        `Repair verification failed for ${unverified.length} snap election row(s); rerun the dry-run before retrying`
      );
    }

    console.log(
      `Matched ${result.matchedCount}, updated ${result.modifiedCount}, and verified ${repairs.length} snap election row(s).`
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
