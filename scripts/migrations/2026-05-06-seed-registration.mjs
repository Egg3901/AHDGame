#!/usr/bin/env node
/**
 * One-shot bootstrap-seed migration: applies the curated Registration /
 * Org values from `src/lib/seeds/registration/registrationLanes.ts` to
 * `StatePartyOrg.registration` (per-party) and `stateRegistrationPool`
 * (per-state) for US/UK/JP/DE. Idempotent — re-running overwrites with
 * the latest curated values and emits a fresh `orgRegLedger` audit row.
 *
 * Per design doc §4.4, validates the pool-sum invariant before writing
 * each row. Aborts the entire migration on the first invariant failure
 * rather than producing a skewed mixed state.
 *
 * Run:  npx tsx scripts/migrations/2026-05-06-seed-registration.mjs
 */

import { MongoClient, ObjectId } from "mongodb";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Resolve relative paths in the .env so we can be invoked from any CWD.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env") });
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env.local") });

const { buildAllRegistrationSeeds, validateSeed } =
  await import("../../src/lib/seeds/registration/registrationLanes.ts");

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error("MONGODB_URI not set. Aborting.");
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);

async function main() {
  await client.connect();
  const dbName = new URL(MONGO_URI).pathname.replace(/^\//, "") || "ahd";
  const db = client.db(dbName);

  const seeds = buildAllRegistrationSeeds();
  console.log(`Loaded ${seeds.length} seed rows across US/UK/JP/DE.`);

  // Validate every seed before writing. Fail fast on invariant errors.
  for (const s of seeds) {
    const err = validateSeed(s);
    if (err) {
      console.error(`Invariant validation failed: ${err}`);
      console.error("Aborting before any writes.");
      process.exit(2);
    }
  }
  console.log("All seed rows pass the pool-sum invariant.");

  // Build a (countryId, abbreviation) → sequentialId lookup so we can
  // translate the seed's party abbreviations into the partyId string the
  // statePartyOrg rows use.
  const parties = await db
    .collection("politicalParties")
    .find({ countryId: { $in: ["US", "UK", "JP", "DE"] } })
    .project({ sequentialId: 1, countryId: 1, abbreviation: 1, name: 1 })
    .toArray();
  const partyKey = (countryId, abbr) => `${countryId}_${abbr}`;
  const partySequentialByAbbr = new Map(
    parties.map((p) => [partyKey(p.countryId, p.abbreviation), String(p.sequentialId)])
  );
  console.log(`Loaded ${parties.length} parties for abbreviation→sequentialId mapping.`);

  let updatedStatePartyOrg = 0;
  let updatedRegistrationPool = 0;
  let writtenLedgerRows = 0;
  const now = new Date();
  const missingMappings = new Set();

  for (const seed of seeds) {
    const { countryId, stateId, parties: seedParties, independent, unregistered } = seed;

    // Update each per-party Reg in StatePartyOrg.
    for (const p of seedParties) {
      const partyId = partySequentialByAbbr.get(partyKey(countryId, p.abbr));
      if (!partyId) {
        missingMappings.add(`${countryId}/${p.abbr}`);
        continue;
      }
      const _id = `${stateId}_${partyId}`;
      await db.collection("statePartyOrg").updateOne(
        { _id },
        {
          $set: { registration: p.reg, updatedAt: now },
          $setOnInsert: {
            _id,
            stateId,
            partyId,
            countryId,
            organization: 0,
            organizationCap: 100,
            momentum: 0,
            chairId: null,
            viceChairId: null,
            treasurerId: null,
            treasury: 0,
            stateTaxRate: 0,
            politicalStrength: 0,
            capContributions: {},
            hasPresence: false,
            createdAt: now,
          },
        },
        { upsert: true }
      );
      updatedStatePartyOrg += 1;

      // Audit ledger row per design doc §5.6 — `seed` source.
      await db.collection("orgRegLedger").insertOne({
        _id: new ObjectId(),
        turn: 0,
        countryId,
        stateId,
        partyId,
        metric: "reg",
        delta: p.reg,
        value: p.reg,
        source: "seed",
        actorId: null,
        note: "registration-bootstrap-seed",
        createdAt: now,
      });
      writtenLedgerRows += 1;
    }

    // Update the state-level pool row.
    const poolId = `${countryId}_${stateId}`;
    await db.collection("stateRegistrationPool").updateOne(
      { _id: poolId },
      {
        $set: {
          countryId,
          stateId,
          independent,
          unregistered,
          lastUpdatedTurn: 0,
          updatedAt: now,
        },
        $setOnInsert: { _id: poolId, createdAt: now },
      },
      { upsert: true }
    );
    updatedRegistrationPool += 1;
  }

  if (missingMappings.size > 0) {
    console.warn(
      `Warning: ${missingMappings.size} (countryId, abbreviation) pairs had no party document; their Reg shares are dropped:`
    );
    for (const m of missingMappings) console.warn(`  - ${m}`);
  }

  console.log(`Wrote ${updatedStatePartyOrg} statePartyOrg rows.`);
  console.log(`Wrote ${updatedRegistrationPool} stateRegistrationPool rows.`);
  console.log(`Wrote ${writtenLedgerRows} orgRegLedger audit rows.`);
}

try {
  await main();
} catch (e) {
  console.error("Migration failed:", e);
  process.exitCode = 1;
} finally {
  await client.close();
}
