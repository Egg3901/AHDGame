/**
 * UK seed script — initialises all UK game data.
 *
 * Seeding order (dependency-safe):
 *   1. UK regions (states collection, countryId: "UK")
 *   2. UK political parties (politicalParties collection)
 *   3. UK demographic categories (demographicCategories collection)
 *   4. UK region demographics (stateDemographics + demographicDefaults collections)
 *   5. UK demographic turnout modifiers (stateDemographicTurnout collection)
 *   6. UK state party orgs (statePartyOrg collection — one per region × party)
 *   7. UK state metrics (stateMetrics collection — ONS data per region)
 *
 * Safe to re-run (upsert-only). Does NOT touch US data.
 *
 * Usage:
 *   npx tsx scripts/seed-uk.ts
 *   npm run seed:uk           # if added to package.json
 */

import { connectDb, closeDb } from "../utils/db";
import type {
  State,
  PoliticalParty,
  DemographicCategory,
  StateDemographics,
  StateDemographicTurnout,
  StatePartyOrg,
  StateMetrics,
} from "../../src/lib/db/types";
import { ukRegions } from "../../src/lib/seeds/uk/ukRegions";
import { ukParties } from "../../src/lib/seeds/uk/ukParties";
import { ukDemographicCategories } from "../../src/lib/seeds/uk/ukDemographicCategories";
import { ukRegionDemographics } from "../../src/lib/seeds/uk/ukRegionDemographics";
import { ukDemographicTurnout } from "../../src/lib/seeds/uk/ukDemographicTurnout";
import { ukStateMetrics } from "../../src/lib/seeds/uk/ukStateMetrics";
import { calculateUKStatePartyOrgs } from "../../src/lib/seeds/uk/ukStatePartyOrgCalculations";
import { calculateStateLean } from "../../src/lib/utils/demographics";
import { ObjectId } from "mongodb";
import { getNextSequentialId } from "../../src/lib/db/sequentialId";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

async function main() {
  console.log("=== UK Seed Script ===\n");
  const db = await connectDb();

  // ── 1. UK Regions ──────────────────────────────────────────────────────────
  console.log("1. Seeding UK regions...");
  for (const region of ukRegions) {
    await db
      .collection<State>("states")
      .updateOne({ _id: region._id }, { $set: region }, { upsert: true });
  }
  console.log(`   ✓ Upserted ${ukRegions.length} UK regions.`);

  // ── 2. UK Parties ──────────────────────────────────────────────────────────
  console.log("2. Seeding UK political parties...");
  const partyNow = new Date();
  for (const party of ukParties) {
    const { seedOrder: _seedOrder, ...partyData } = party;
    // Check if party already exists by name + country
    const existing = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ name: party.name, countryId: party.countryId });

    if (existing) {
      // Update existing party (preserve _id and sequentialId)
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: existing._id }, { $set: { ...partyData, updatedAt: partyNow } });
    } else {
      // Insert new party with generated _id and sequentialId
      const sequentialId = await getNextSequentialId(db, "party", party.countryId);
      const doc: PoliticalParty = {
        _id: new ObjectId(),
        sequentialId,
        ...partyData,
        createdAt: partyNow,
        updatedAt: partyNow,
      };
      await db.collection<PoliticalParty>("politicalParties").insertOne(doc);
    }
  }
  console.log(`   ✓ Upserted ${ukParties.length} UK parties.`);

  // ── 3. UK Demographic Categories ──────────────────────────────────────────
  console.log("3. Seeding UK demographic categories (voter archetypes)...");
  for (const category of ukDemographicCategories) {
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id: category._id }, { $set: category }, { upsert: true });
  }
  const groupCount = ukDemographicCategories.reduce((s, c) => s + c.groups.length, 0);
  console.log(
    `   ✓ Upserted ${ukDemographicCategories.length} category (${groupCount} UK voter archetypes).`
  );

  // ── 4. UK Region Demographics ──────────────────────────────────────────────
  console.log("4. Seeding UK region demographics...");
  for (const sd of ukRegionDemographics) {
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id: sd._id }, { $set: sd }, { upsert: true });
    await db
      .collection<StateDemographics>("demographicDefaults")
      .updateOne({ _id: sd._id }, { $set: sd }, { upsert: true });

    // Cache economic/social lean on the region document
    const allCategories = await db
      .collection<DemographicCategory>("demographicCategories")
      .find({})
      .toArray();
    const lean = calculateStateLean(sd, allCategories);
    await db.collection<State>("states").updateOne(
      { _id: sd._id },
      {
        $set: {
          cachedEconomicLean: lean.economicLean,
          cachedSocialLean: lean.socialLean,
          demographicsLastUpdated: new Date(),
        },
      }
    );
  }
  console.log(`   ✓ Upserted ${ukRegionDemographics.length} UK region demographics.`);

  // ── 5. UK Demographic Turnout ──────────────────────────────────────────────
  console.log("5. Seeding UK demographic turnout modifiers (all zeros)...");
  for (const doc of ukDemographicTurnout) {
    await db
      .collection<StateDemographicTurnout>("stateDemographicTurnout")
      .updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
  }
  console.log(`   ✓ Upserted ${ukDemographicTurnout.length} UK turnout modifier documents.`);

  // ── 6. UK State Party Orgs ──────────────────────────────────────────────────
  console.log("6. Seeding UK state party orgs (calculated from preset polling)...");
  const ukSeedGameState = await db
    .collection<{ _id: string; preset?: string }>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  const ukSeedPreset = ukSeedGameState?.preset ?? DEFAULT_SEED_PRESET;
  const ukStatePartyOrgs = await calculateUKStatePartyOrgs(db, ukSeedPreset);
  const now = new Date();
  for (const org of ukStatePartyOrgs) {
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne(
        { _id: org._id },
        { $set: { ...org, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
  }
  console.log(
    `   ✓ Upserted ${ukStatePartyOrgs.length} UK state party org documents (calculated from vote share).`
  );

  // ── 7. UK State Metrics ───────────────────────────────────────────────────
  console.log("7. Seeding UK state metrics (region-level ONS data)...");
  for (const m of ukStateMetrics) {
    await db
      .collection<StateMetrics>("stateMetrics")
      .updateOne({ _id: m._id }, { $set: m }, { upsert: true });
  }
  console.log(`   ✓ Upserted ${ukStateMetrics.length} UK state metrics.`);

  console.log("\n=== UK Seed Complete ===");
  console.log(
    `Regions: ${ukRegions.length}, Parties: ${ukParties.length}, ` +
      `Archetypes: ${groupCount}, Party Orgs: ${ukStatePartyOrgs.length}, Metrics: ${ukStateMetrics.length}`
  );
}

main()
  .catch((err) => {
    console.error("UK seed failed:", err);
    process.exit(1);
  })
  .finally(closeDb);
