/**
 * Incident repair, not a deploy migration. Dry-run by default, no writes at all.
 * npx tsx scripts/migrations/heal-registration-without-presence.ts --live --env-file=/path/.env.local
 * Applying additionally requires --apply --expected-turn=N, paused turns and
 * full maintenance mode. Deploy the presence fix before applying this repair.
 */
import dotenv from "dotenv";
import { MongoClient, ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  Character,
  ElectedOfficial,
  GameConfig,
  GameState,
  NPP,
  OrgRegLedger,
  State,
} from "../../src/lib/db/types";
import { POOL_SENTINEL_PARTY_ID } from "../../src/lib/db/types";
import type { AdminLog } from "../../src/lib/db/types/adminLog";
import type { CountryId } from "../../src/lib/constants/countries";
import { buildRegistrationPresence } from "../../src/lib/parties/rules/registrationPresence";
import {
  planAbsentRegistrationHeal,
  type HealPartyRow,
  type HealPool,
} from "../../src/lib/parties/rules/absentRegistrationHeal";

export async function inspectRegistrationHeal(db: Db, session: ClientSession) {
  // Sequential reads: Mongo does not support parallel operations in a transaction.
  const clock = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session });
  if (!clock || clock.isProcessing)
    throw new Error("Missing clock or turn processing in progress; retry between turns");
  const regions = await db
    .collection<State>("states")
    .find({}, { session, projection: { countryId: 1 } })
    .toArray();
  const rows = await db
    .collection<HealPartyRow>("statePartyOrg")
    .find(
      {},
      {
        session,
        projection: { countryId: 1, stateId: 1, partyId: 1, registration: 1, organization: 1 },
      }
    )
    .toArray();
  const pools = await db
    .collection<HealPool>("stateRegistrationPool")
    .find(
      {},
      { session, projection: { countryId: 1, stateId: 1, independent: 1, unregistered: 1 } }
    )
    .toArray();
  const players = await db
    .collection<Character>("characters")
    .find({}, { session, projection: { _id: 0, countryId: 1, party: 1, homeState: 1 } })
    .toArray();
  const npps = await db
    .collection<NPP>("npps")
    .find(
      { retiredAt: null },
      { session, projection: { _id: 0, countryId: 1, party: 1, homeState: 1 } }
    )
    .toArray();
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({}, { session, projection: { _id: 0, countryId: 1, party: 1, state: 1 } })
    .toArray();
  const regionKeys = new Set(regions.map((r) => JSON.stringify([r.countryId, r._id])));
  if (rows.some((r) => !regionKeys.has(JSON.stringify([r.countryId, r.stateId])))) {
    throw new Error("Unknown or unscoped party region; resolve before healing");
  }
  // Unlike the spending gate, a destructive heal must stop on ambiguous legacy
  // rosters rather than assuming that a missing country means no presence.
  const members = [...players, ...npps, ...officials.map((o) => ({ ...o, homeState: o.state }))];
  for (const member of members) {
    if (!member.party || member.party === "independent" || !member.homeState) continue;
    const matches = regions.filter(
      (r) => r._id === member.homeState && (!member.countryId || r.countryId === member.countryId)
    );
    if (matches.length !== 1)
      throw new Error("Ambiguous or unknown roster region; resolve before healing");
  }
  const presence = buildRegistrationPresence(
    regions.map((r) => ({ countryId: r.countryId, stateId: r._id })),
    players,
    npps,
    officials
  );
  return { clock, ...planAbsentRegistrationHeal(rows, pools, presence) };
}

export async function runRegistrationHeal(
  client: MongoClient,
  options: { apply?: boolean; expectedTurn?: number } = {}
) {
  const db = client.db();
  const session = client.startSession();
  try {
    return await session.withTransaction(
      async () => {
        const plan = await inspectRegistrationHeal(db, session);
        if (!options.apply) return plan;
        const config = await db
          .collection<GameConfig>("gameConfig")
          .findOne({ _id: "default" }, { session });
        if (
          plan.clock.isActive !== false ||
          config?.maintenanceMode !== "full" ||
          options.expectedTurn !== plan.clock.currentTurn
        ) {
          throw new Error(
            "Apply requires full maintenance, paused turns and a matching --expected-turn"
          );
        }
        if (plan.blocked.length)
          throw new Error("Invalid regional pools block the entire repair; inspect dry-run output");
        if (!plan.transfers.length) return plan;
        const now = new Date();
        // Serialize against resuming the clock or leaving full maintenance.
        const lockedClock = await db.collection<GameState>("gameState").updateOne(
          {
            _id: plan.clock._id,
            currentTurn: plan.clock.currentTurn,
            isActive: false,
            isProcessing: { $ne: true },
          },
          { $set: { updatedAt: now } },
          { session }
        );
        const lockedConfig = await db
          .collection<GameConfig>("gameConfig")
          .updateOne(
            { _id: "default", maintenanceMode: "full" },
            { $set: { updatedAt: now } },
            { session }
          );
        if (lockedClock.matchedCount !== 1 || lockedConfig.matchedCount !== 1)
          throw new Error("Maintenance or clock changed");
        // Keep the exact preimages server-side for recovery, never in source control.
        await db.collection<AdminLog>("adminLogs").insertOne(
          {
            _id: new ObjectId(),
            category: "system",
            action: "party_org_updated",
            username: "CLI",
            createdAt: now,
            details: JSON.stringify({
              repair: "registration-without-presence",
              turn: plan.clock.currentTurn,
              transfers: plan.transfers,
              pools: plan.poolChanges,
            }),
          },
          { session }
        );
        const partyResult = await db.collection<HealPartyRow>("statePartyOrg").bulkWrite(
          plan.transfers.map(({ row, amount }) => ({
            updateOne: {
              filter: {
                _id: row._id,
                countryId: row.countryId,
                stateId: row.stateId,
                partyId: row.partyId,
                registration: amount,
              },
              update: { $set: { registration: 0, updatedAt: now } },
            },
          })),
          { session }
        );
        const poolResult = await db.collection<HealPool>("stateRegistrationPool").bulkWrite(
          plan.poolChanges.map(({ pool, amount }) => ({
            updateOne: {
              filter: {
                _id: pool._id,
                countryId: pool.countryId,
                stateId: pool.stateId,
                independent: pool.independent,
                unregistered: pool.unregistered,
              },
              update: {
                $inc: { independent: amount },
                $set: { lastUpdatedTurn: plan.clock.currentTurn, updatedAt: now },
              },
            },
          })),
          { session }
        );
        if (
          partyResult.matchedCount !== plan.transfers.length ||
          poolResult.matchedCount !== plan.poolChanges.length
        )
          throw new Error("Repair preimage changed; aborting");
        const ledger: OrgRegLedger[] = [
          ...plan.transfers.map(({ row, amount }) => ({
            countryId: row.countryId as CountryId,
            stateId: row.stateId,
            partyId: row.partyId,
            metric: "reg" as const,
            delta: -amount,
            value: 0,
          })),
          ...plan.poolChanges.map(({ pool, amount }) => ({
            countryId: pool.countryId as CountryId,
            stateId: pool.stateId,
            partyId: POOL_SENTINEL_PARTY_ID,
            metric: "independent" as const,
            delta: amount,
            value: pool.independent + amount,
          })),
        ].map((row) => ({
          ...row,
          _id: new ObjectId(),
          turn: plan.clock.currentTurn,
          source: "migration",
          actorId: null,
          note: "migration:registrationWithoutPresence",
          createdAt: now,
        }));
        await db.collection<OrgRegLedger>("orgRegLedger").insertMany(ledger, { session });
        const after = await inspectRegistrationHeal(db, session);
        if (after.transfers.length || after.blocked.length)
          throw new Error("Post-repair validation failed");
        return plan;
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }
    );
  } finally {
    await session.endSession();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.some(
      (a) =>
        !["--apply", "--dry-run", "--live", "--direct-connection"].includes(a) &&
        !a.startsWith("--env-file=") &&
        !a.startsWith("--expected-turn=")
    )
  )
    throw new Error("Unknown argument");
  if (args.includes("--apply") && args.includes("--dry-run"))
    throw new Error("Choose --apply or --dry-run, not both");
  dotenv.config({
    path: args.find((a) => a.startsWith("--env-file="))?.slice(11) ?? ".env.local",
    quiet: true,
  });
  const uri = args.includes("--live") ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
  if (!uri) throw new Error("Requested database URI is not configured");
  const expected = args.find((a) => a.startsWith("--expected-turn="))?.slice(16);
  const expectedTurn = expected === undefined ? undefined : Number(expected);
  if (args.includes("--apply") && (!Number.isSafeInteger(expectedTurn) || expectedTurn! < 0))
    throw new Error("Apply requires --expected-turn=N");
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15000,
    ...(args.includes("--direct-connection") ? { directConnection: true } : {}),
  });
  try {
    await client.connect();
    const result = await runRegistrationHeal(client, {
      apply: args.includes("--apply"),
      expectedTurn,
    });
    console.log(
      JSON.stringify(
        {
          mode: args.includes("--apply") ? "APPLIED" : "DRY RUN (no writes)",
          turn: result.clock.currentTurn,
          affectedPartyRegions: result.transfers.length,
          affectedRegions: result.poolChanges.length,
          transfers: result.transfers,
          pools: result.poolChanges,
          blocked: result.blocked,
        },
        null,
        2
      )
    );
    if (result.blocked.length) process.exitCode = 2;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // Driver errors can contain connection details. Never echo the URI.
    console.error(
      error instanceof Error && error.name === "Error"
        ? error.message
        : "Database operation failed; connection details withheld"
    );
    process.exitCode = 1;
  });
}
