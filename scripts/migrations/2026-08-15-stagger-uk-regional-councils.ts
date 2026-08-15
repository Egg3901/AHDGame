/**
 * Mark the currently synchronized UK Regional Council election as transition
 * cycle 0. Once it resolves, the perpetual spawner creates each region's
 * cycle 1 election on its annual cohort schedule.
 *
 * This migration is intentionally narrow and idempotent. It requires exactly
 * one live council election in every configured UK region, verifies that each
 * still closes with that region's live Commons election, and accepts only
 * cycle 1 (pending migration) or cycle 0 (already migrated).
 *
 * Defaults to DRY RUN against MONGODB_URI_LIVE, falling back to the ambient
 * production MONGODB_URI used by the app. Pass --apply to write changes, or
 * --db=test / --db=local to select another configured database URI. Operators
 * may supply --env-file=<path> and --uri-env=<name> when credentials live in
 * a separate operations environment file.
 */

import { MongoClient, ObjectId, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  UK_REGIONAL_COUNCIL_COHORT_BY_REGION,
  getUKRegionalCouncilCohort,
} from "../../src/lib/elections/ukRegionalCouncilStagger";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env.local") });
const envFileArg = process.argv.find((arg) => arg.startsWith("--env-file="))?.slice(11);
if (envFileArg) dotenv.config({ path: path.resolve(envFileArg), override: true });

interface LiveElection {
  _id: ObjectId;
  countryId: string;
  electionType: string;
  state?: string;
  status: string;
  cycle?: number;
  electionYear?: number;
  endTurn?: number;
  endTime?: Date;
  updatedAt?: Date;
}

function dbNameFromUri(uri: string): string | undefined {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^/]+@)?[^/]+\/([^?/]*)/i);
  const dbName = match?.[1]?.trim();
  return dbName ? decodeURIComponent(dbName) : undefined;
}

function pickTarget(): { uri: string; dbName: string } {
  const dbArg = process.argv.find((arg) => arg.startsWith("--db="))?.slice(5) ?? "live";
  const uriEnvName = process.argv.find((arg) => arg.startsWith("--uri-env="))?.slice(10);
  const explicitUri = uriEnvName ? process.env[uriEnvName] : undefined;
  if (uriEnvName && !explicitUri) throw new Error(`${uriEnvName} not set`);
  const uri =
    explicitUri ??
    (dbArg === "live"
      ? (process.env.MONGODB_URI_LIVE ?? process.env.MONGODB_URI)
      : dbArg === "test"
        ? process.env.MONGODB_URI_TEST
        : dbArg === "local"
          ? process.env.MONGODB_URI
          : null);
  if (uri === null) throw new Error(`Unsupported database target: ${dbArg}`);
  if (!uri) throw new Error(`Database URI for ${dbArg} is not set`);
  const dbName =
    process.env.MONGODB_DB?.trim() ||
    process.env.MONGO_DB_NAME?.trim() ||
    dbNameFromUri(uri) ||
    "a-house-divided";
  return { uri, dbName };
}

function assertSameClose(council: LiveElection, commons: LiveElection): void {
  if (council.endTurn != null && commons.endTurn != null) {
    if (council.endTurn !== commons.endTurn) {
      throw new Error(
        `${council.state}: council endTurn ${council.endTurn} does not match Commons ${commons.endTurn}`
      );
    }
    return;
  }

  if (!council.endTime || !commons.endTime) {
    throw new Error(`${council.state}: cannot verify synchronized close`);
  }
  if (new Date(council.endTime).getTime() !== new Date(commons.endTime).getTime()) {
    throw new Error(`${council.state}: council endTime does not match Commons`);
  }
}

async function loadValidatedTransition(db: Db): Promise<LiveElection[]> {
  const liveStatuses = { $in: ["active", "upcoming"] };
  const [councils, commons] = await Promise.all([
    db
      .collection<LiveElection>("elections")
      .find({ countryId: "UK", electionType: "regionalCouncil", status: liveStatuses })
      .toArray(),
    db
      .collection<LiveElection>("elections")
      .find({ countryId: "UK", electionType: "commons", status: liveStatuses })
      .toArray(),
  ]);

  const expectedRegions = Object.keys(UK_REGIONAL_COUNCIL_COHORT_BY_REGION).sort();
  const councilByRegion = new Map(councils.map((election) => [election.state, election]));
  const commonsByRegion = new Map(commons.map((election) => [election.state, election]));

  if (
    councils.length !== expectedRegions.length ||
    councilByRegion.size !== expectedRegions.length
  ) {
    throw new Error(
      `Expected ${expectedRegions.length} unique live council elections, found ${councils.length}`
    );
  }

  for (const regionId of expectedRegions) {
    const council = councilByRegion.get(regionId);
    const regionCommons = commonsByRegion.get(regionId);
    if (!council) throw new Error(`${regionId}: live council election missing`);
    if (!regionCommons) throw new Error(`${regionId}: live Commons election missing`);
    if (council.cycle !== 0 && council.cycle !== 1) {
      throw new Error(`${regionId}: expected transition cycle 0 or 1, found ${council.cycle}`);
    }
    assertSameClose(council, regionCommons);
  }

  const unexpectedRegions = [...councilByRegion.keys()].filter(
    (regionId) => !regionId || !(regionId in UK_REGIONAL_COUNCIL_COHORT_BY_REGION)
  );
  if (unexpectedRegions.length > 0) {
    throw new Error(`Unexpected live council regions: ${unexpectedRegions.join(", ")}`);
  }

  return expectedRegions.map((regionId) => councilByRegion.get(regionId)!);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const { uri, dbName } = pickTarget();
  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db(dbName) as Db;
    const councils = await loadValidatedTransition(db);
    const pending = councils.filter((election) => election.cycle === 1);

    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
    for (const election of councils) {
      console.log(
        `${election.state}: cycle ${election.cycle} -> 0, cohort ${getUKRegionalCouncilCohort(election.state)}, closes ${election.endTime?.toISOString() ?? `turn ${election.endTurn}`}`
      );
    }

    if (pending.length === 0) {
      console.log("No changes needed. All live councils are already transition cycle 0.");
      return;
    }
    if (!apply) {
      console.log(`Dry run complete. ${pending.length} council elections would be updated.`);
      return;
    }

    const now = new Date();
    const result = await db.collection<LiveElection>("elections").updateMany(
      {
        _id: { $in: pending.map((election) => election._id) },
        countryId: "UK",
        electionType: "regionalCouncil",
        status: { $in: ["active", "upcoming"] },
        cycle: 1,
      },
      { $set: { cycle: 0, updatedAt: now } }
    );

    if (result.modifiedCount !== pending.length) {
      throw new Error(
        `Expected to update ${pending.length} elections, updated ${result.modifiedCount}`
      );
    }

    const verified = await loadValidatedTransition(db);
    if (verified.some((election) => election.cycle !== 0)) {
      throw new Error("Post-write verification found a council outside transition cycle 0");
    }
    console.log(`Applied and verified ${result.modifiedCount} council election updates.`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
