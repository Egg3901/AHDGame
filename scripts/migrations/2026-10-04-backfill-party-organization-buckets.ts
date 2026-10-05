/**
 * Backfill live state-party organization rows into durable contribution buckets.
 *
 * The permanent 100-unit Unaffiliated stake is a rules constant and is not
 * persisted as a fake party row. This migration:
 *   - converts legacy Org% into `organizationUnits` with the production rules;
 *   - initializes missing inactivity clocks to the current game turn so rollout
 *     cannot immediately decay established parties; and
 *   - rewrites cached `organization` shares from the resulting regional bucket.
 *
 * Safety:
 *   - targets MONGODB_URI_LIVE only, with no local fallback;
 *   - defaults to a read-only dry-run;
 *   - requires both --apply and --confirm-live before writing;
 *   - updates each region in a transaction; and
 *   - uses snapshot filters so a concurrent Build Org write cannot be replaced.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-10-04-backfill-party-organization-buckets.ts
 *   npx tsx scripts/migrations/2026-10-04-backfill-party-organization-buckets.ts --apply --confirm-live
 */
import { MongoClient, type ClientSession, type Db, type Filter } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { deriveOrganizationShares } from "@/lib/parties/rules/organizationBucket";
import { ORG_BUCKET_BASELINE_UNITS } from "@/lib/constants/partyOrg";
import { resolveMongoDbName } from "@/lib/mongodb";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const APPLY = process.argv.includes("--apply");
const CONFIRM_LIVE = process.argv.includes("--confirm-live");
const MAX_CONCURRENT_RETRIES = 3;

export interface PartyOrganizationMigrationRow {
  _id: string;
  countryId?: string;
  stateId?: string;
  partyId?: string;
  organization?: number;
  organizationUnits?: number;
  lastOrganizationBuildTurn?: number;
  updatedAt?: Date;
}

export interface PartyOrganizationRowPlan {
  id: string;
  previousOrganization: number | undefined;
  previousOrganizationUnits: number | undefined;
  previousLastOrganizationBuildTurn: number | undefined;
  organization: number;
  organizationUnits: number;
  lastOrganizationBuildTurn: number;
  changed: boolean;
  initializesUnits: boolean;
  initializesClock: boolean;
}

export interface PartyOrganizationRegionPlan {
  rows: PartyOrganizationRowPlan[];
  changedRows: number;
  initializedUnitRows: number;
  initializedClockRows: number;
  partyUnits: number;
  denominatorUnits: number;
  unaffiliatedUnits: number;
}

interface RegionRows {
  countryId: string;
  stateId: string;
  rows: PartyOrganizationMigrationRow[];
}

interface MigrationTotals {
  regions: number;
  rows: number;
  changedRows: number;
  initializedUnitRows: number;
  initializedClockRows: number;
  matchedRows: number;
  modifiedRows: number;
  retriedRegions: number;
}

class ConcurrentMigrationWriteError extends Error {}

function finiteOrZero(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0;
}

function validOrganizationUnits(value: number | undefined): value is number {
  return Number.isFinite(value) && (value as number) >= 0;
}

function validTurn(value: number | undefined): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

/** Pure migration planner. Production bucket rules remain the formula owner. */
export function planPartyOrganizationRegion(
  rows: readonly PartyOrganizationMigrationRow[],
  currentTurn: number
): PartyOrganizationRegionPlan {
  if (!Number.isInteger(currentTurn) || currentTurn < 0) {
    throw new Error(`Invalid current turn: ${currentTurn}`);
  }

  const derived = deriveOrganizationShares(
    rows.map((row) => ({
      id: row._id,
      organization: finiteOrZero(row.organization),
      organizationUnits: row.organizationUnits,
      lastOrganizationBuildTurn: row.lastOrganizationBuildTurn,
    }))
  );
  const sourceById = new Map(rows.map((row) => [row._id, row]));
  const plannedRows = derived.rows.map((resolved) => {
    const source = sourceById.get(resolved.id);
    if (!source) throw new Error(`Missing source row ${resolved.id}`);
    const initializesUnits = !validOrganizationUnits(source.organizationUnits);
    const initializesClock = !validTurn(source.lastOrganizationBuildTurn);
    const lastOrganizationBuildTurn = initializesClock
      ? currentTurn
      : (source.lastOrganizationBuildTurn as number);
    const changed =
      source.organizationUnits !== resolved.organizationUnits ||
      source.lastOrganizationBuildTurn !== lastOrganizationBuildTurn ||
      !Number.isFinite(source.organization) ||
      Math.abs(finiteOrZero(source.organization) - resolved.organization) >= 0.00005;

    return {
      id: source._id,
      previousOrganization: source.organization,
      previousOrganizationUnits: source.organizationUnits,
      previousLastOrganizationBuildTurn: source.lastOrganizationBuildTurn,
      organization: resolved.organization,
      organizationUnits: resolved.organizationUnits,
      lastOrganizationBuildTurn,
      changed,
      initializesUnits,
      initializesClock,
    };
  });

  return {
    rows: plannedRows,
    changedRows: plannedRows.filter((row) => row.changed).length,
    initializedUnitRows: plannedRows.filter((row) => row.changed && row.initializesUnits).length,
    initializedClockRows: plannedRows.filter((row) => row.changed && row.initializesClock).length,
    partyUnits: derived.totalUnits,
    denominatorUnits: derived.denominatorUnits,
    unaffiliatedUnits: derived.unaffiliatedUnits,
  };
}

function groupRows(rows: PartyOrganizationMigrationRow[]): RegionRows[] {
  const invalidRows = rows.filter(
    (row) =>
      typeof row._id !== "string" ||
      !row._id.trim() ||
      typeof row.countryId !== "string" ||
      !row.countryId.trim() ||
      typeof row.stateId !== "string" ||
      !row.stateId.trim()
  );
  if (invalidRows.length > 0) {
    const sample = invalidRows
      .slice(0, 10)
      .map((row) => String(row._id))
      .join(", ");
    throw new Error(
      `${invalidRows.length} statePartyOrg row(s) have an invalid id, countryId, or stateId. ` +
        `No writes are safe until they are repaired. Sample ids: ${sample}`
    );
  }

  const byRegion = new Map<string, RegionRows>();
  for (const row of rows) {
    const countryId = row.countryId as string;
    const stateId = row.stateId as string;
    const key = `${countryId}\u0000${stateId}`;
    const region = byRegion.get(key) ?? { countryId, stateId, rows: [] };
    region.rows.push(row);
    byRegion.set(key, region);
  }
  return [...byRegion.values()].sort(
    (a, b) => a.countryId.localeCompare(b.countryId) || a.stateId.localeCompare(b.stateId)
  );
}

function projectedRows(
  db: Db,
  filter: Filter<PartyOrganizationMigrationRow> = {},
  session?: ClientSession
) {
  return db
    .collection<PartyOrganizationMigrationRow>("statePartyOrg")
    .find(filter, { session })
    .project<PartyOrganizationMigrationRow>({
      _id: 1,
      countryId: 1,
      stateId: 1,
      partyId: 1,
      organization: 1,
      organizationUnits: 1,
      lastOrganizationBuildTurn: 1,
      updatedAt: 1,
    });
}

function exactFieldFilter<K extends keyof PartyOrganizationMigrationRow>(
  field: K,
  value: PartyOrganizationMigrationRow[K]
): Filter<PartyOrganizationMigrationRow> {
  return (
    value === undefined ? { [field]: { $exists: false } } : { [field]: value }
  ) as Filter<PartyOrganizationMigrationRow>;
}

function snapshotFilter(row: PartyOrganizationMigrationRow): Filter<PartyOrganizationMigrationRow> {
  return {
    _id: row._id,
    countryId: row.countryId,
    stateId: row.stateId,
    $and: [
      exactFieldFilter("organization", row.organization),
      exactFieldFilter("organizationUnits", row.organizationUnits),
      exactFieldFilter("lastOrganizationBuildTurn", row.lastOrganizationBuildTurn),
    ],
  };
}

function addPlanToTotals(totals: MigrationTotals, plan: PartyOrganizationRegionPlan): void {
  totals.rows += plan.rows.length;
  totals.changedRows += plan.changedRows;
  totals.initializedUnitRows += plan.initializedUnitRows;
  totals.initializedClockRows += plan.initializedClockRows;
}

async function applyRegion(
  client: MongoClient,
  db: Db,
  region: Pick<RegionRows, "countryId" | "stateId">,
  currentTurn: number,
  now: Date
): Promise<{
  plan: PartyOrganizationRegionPlan;
  matchedRows: number;
  modifiedRows: number;
  retries: number;
}> {
  for (let attempt = 0; attempt <= MAX_CONCURRENT_RETRIES; attempt += 1) {
    const session = client.startSession();
    try {
      let committed:
        | { plan: PartyOrganizationRegionPlan; matchedRows: number; modifiedRows: number }
        | undefined;
      await session.withTransaction(
        async () => {
          const liveRows = await projectedRows(
            db,
            {
              countryId: region.countryId,
              stateId: region.stateId,
            },
            session
          ).toArray();
          const plan = planPartyOrganizationRegion(liveRows, currentTurn);
          const changedRows = plan.rows.filter((row) => row.changed);
          if (changedRows.length === 0) {
            committed = { plan, matchedRows: 0, modifiedRows: 0 };
            return;
          }

          const sourceById = new Map(liveRows.map((row) => [row._id, row]));
          const result = await db
            .collection<PartyOrganizationMigrationRow>("statePartyOrg")
            .bulkWrite(
              changedRows.map((row) => {
                const source = sourceById.get(row.id);
                if (!source) throw new Error(`Missing live row ${row.id}`);
                return {
                  updateOne: {
                    filter: snapshotFilter(source),
                    update: {
                      $set: {
                        organization: row.organization,
                        organizationUnits: row.organizationUnits,
                        lastOrganizationBuildTurn: row.lastOrganizationBuildTurn,
                        updatedAt: now,
                      },
                    },
                  },
                };
              }),
              { ordered: true, session }
            );
          if (result.matchedCount !== changedRows.length) {
            throw new ConcurrentMigrationWriteError(
              `Region ${region.countryId}:${region.stateId} changed during migration ` +
                `(matched ${result.matchedCount}/${changedRows.length})`
            );
          }
          committed = {
            plan,
            matchedRows: result.matchedCount,
            modifiedRows: result.modifiedCount,
          };
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
          readPreference: "primary",
        }
      );
      if (!committed)
        throw new Error(`Region ${region.countryId}:${region.stateId} did not commit`);
      return { ...committed, retries: attempt };
    } catch (error) {
      if (error instanceof ConcurrentMigrationWriteError && attempt < MAX_CONCURRENT_RETRIES) {
        continue;
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
  throw new Error(`Region ${region.countryId}:${region.stateId} exceeded retry limit`);
}

function emptyTotals(regions: number): MigrationTotals {
  return {
    regions,
    rows: 0,
    changedRows: 0,
    initializedUnitRows: 0,
    initializedClockRows: 0,
    matchedRows: 0,
    modifiedRows: 0,
    retriedRegions: 0,
  };
}

function printTotals(mode: "DRY RUN" | "APPLY", totals: MigrationTotals): void {
  console.log(`\n=== ${mode} SUMMARY ===`);
  console.log(`Regions: ${totals.regions}`);
  console.log(`Rows inspected: ${totals.rows}`);
  console.log(`Rows requiring change: ${totals.changedRows}`);
  console.log(`Legacy/corrupt unit balances initialized: ${totals.initializedUnitRows}`);
  console.log(`Missing/corrupt inactivity clocks initialized: ${totals.initializedClockRows}`);
  if (mode === "APPLY") {
    console.log(`Rows matched: ${totals.matchedRows}`);
    console.log(`Rows modified: ${totals.modifiedRows}`);
    console.log(`Regions retried after concurrent writes: ${totals.retriedRegions}`);
  }
  console.log(`Permanent Unaffiliated stake per region: ${ORG_BUCKET_BASELINE_UNITS} units`);
}

async function main(): Promise<void> {
  if (APPLY && !CONFIRM_LIVE) {
    throw new Error("Refusing LIVE writes without --confirm-live (use with --apply)");
  }
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE must be set in .env.local");
  const dbName = resolveMongoDbName({
    MONGODB_URI: uri,
    MONGODB_DB: process.env.MONGODB_DB,
    MONGO_DB_NAME: process.env.MONGO_DB_NAME,
  });
  // Railway's single-node replica set advertises an internal localhost member.
  // Connect to the public seed directly so the driver does not follow that address.
  const client = new MongoClient(uri, {
    directConnection: true,
    serverSelectionTimeoutMS: 10_000,
  });
  await client.connect();
  try {
    const db = client.db(dbName);
    const gameState = await db
      .collection<{ _id: string; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
    const currentTurn = gameState?.currentTurn;
    if (!Number.isInteger(currentTurn) || (currentTurn as number) < 0) {
      throw new Error("gameState.currentTurn is missing or invalid");
    }

    const initialRows = await projectedRows(db).toArray();
    const regions = groupRows(initialRows);
    const totals = emptyTotals(regions.length);
    const now = new Date();
    console.log(APPLY ? "=== APPLY MODE: LIVE ===" : "=== DRY RUN: LIVE, NO WRITES ===");
    console.log(`Database: ${dbName}`);
    console.log(`Current turn: ${currentTurn}`);
    console.log(`statePartyOrg rows: ${initialRows.length}`);
    console.log(`Regional buckets: ${regions.length}`);

    if (!APPLY) {
      const samples: string[] = [];
      for (const region of regions) {
        const plan = planPartyOrganizationRegion(region.rows, currentTurn as number);
        addPlanToTotals(totals, plan);
        if (plan.changedRows > 0 && samples.length < 12) {
          samples.push(
            `${region.countryId}:${region.stateId} rows=${plan.rows.length} ` +
              `changes=${plan.changedRows} units=${plan.partyUnits} denominator=${plan.denominatorUnits}`
          );
        }
      }
      printTotals("DRY RUN", totals);
      if (samples.length > 0) {
        console.log("\nSample affected regions:");
        for (const sample of samples) console.log(`  ${sample}`);
      }
      console.log("\nNo writes performed. Re-run with --apply --confirm-live to migrate LIVE.");
      return;
    }

    for (const region of regions) {
      const result = await applyRegion(client, db, region, currentTurn as number, now);
      addPlanToTotals(totals, result.plan);
      totals.matchedRows += result.matchedRows;
      totals.modifiedRows += result.modifiedRows;
      if (result.retries > 0) totals.retriedRegions += 1;
    }

    printTotals("APPLY", totals);
    const remaining = groupRows(await projectedRows(db).toArray()).reduce(
      (count, region) =>
        count + planPartyOrganizationRegion(region.rows, currentTurn as number).changedRows,
      0
    );
    if (remaining > 0) {
      throw new Error(
        `${remaining} row(s) still require migration. A concurrent writer may have changed them; rerun safely.`
      );
    }
    console.log("Verification passed: every regional bucket is fully materialized and idempotent.");
  } finally {
    await client.close();
  }
}

const isMain =
  typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
