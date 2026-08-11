/**
 * Germany seed script — initialises all DE game data.
 *
 * Seeding order (dependency-safe):
 *   1. DE regions (states collection, countryId: "DE")
 *   2. DE political parties (politicalParties collection)
 *   3. DE demographic categories (demographicCategories collection)
 *   4. DE region demographics (stateDemographics + demographicDefaults collections)
 *   5. DE demographic turnout modifiers (stateDemographicTurnout collection)
 *   6. DE state party orgs (statePartyOrg collection — one per Land × party)
 *   7. DE state metrics (stateMetrics collection — Destatis data per Land)
 *   8. DE state metric baselines (stateMetricBaselines collection)
 *   9. DE governmentFormations document (pending Chancellor election)
 *  10. DE legislation types (legislationTypes collection — tier-1 subset) *
 * Note: Germany's Federal President (Bundespräsident) is created at runtime via
 * the admin imperial-character flow (config.hasImperialRole = true), not seeded.
 *
 * Safe to re-run (upsert-only). Does NOT touch US/UK/JP data.
 * Census-layer profiles in deRegionCensusData.ts are build-time constants
 * imported by API routes — no DB collection to seed there.
 *
 * Usage:
 *   npx tsx scripts/seed-de.ts
 *   npm run seed:de           # when added to package.json
 */

import { connectDb, closeDb } from "./utils/db";
import type {
  State,
  PoliticalParty,
  DemographicCategory,
  StateDemographics,
  StateDemographicTurnout,
  StatePartyOrg,
  StateMetrics,
} from "../src/lib/db/types";
import type { StateMetricBaseline } from "../src/lib/db/types/statePolicy";
import type { GovernmentFormation } from "../src/lib/db/types/governmentFormation";
import type { LegislationType } from "../src/lib/db/types/legislation";
import { deRegions } from "../src/lib/seeds/de/deRegions";
import { deParties } from "../src/lib/seeds/de/deParties";
import { deDemographicCategories } from "../src/lib/seeds/de/deDemographicCategories";
import { deRegionDemographics } from "../src/lib/seeds/de/deRegionDemographics";
import { deDemographicTurnout } from "../src/lib/seeds/de/deDemographicTurnout";
import { calculateDEStatePartyOrgs } from "../src/lib/seeds/de/deStatePartyOrgCalculations";
import { deStateMetrics } from "../src/lib/seeds/de/deStateMetrics";
import { deStateBaselines } from "../src/lib/seeds/de/deStateBaselines";
import { deGovernmentFormation } from "../src/lib/seeds/de/deGovernmentFormation";
import { deLegislationTypes } from "../src/lib/seeds/de/deLegislationTypes";
import { calculateStateLean } from "../src/lib/utils/demographics";
import { ObjectId } from "mongodb";
import { getNextSequentialId } from "../src/lib/db/sequentialId";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

async function main() {
  console.log("=== Germany Seed Script ===\n");
  const db = await connectDb();

  // ── 1. DE Regions ─────────────────────────────────────────────────────────
  console.log("1. Seeding DE Bundesländer...");
  for (const region of deRegions) {
    await db
      .collection<State>("states")
      .updateOne({ _id: region._id }, { $set: region }, { upsert: true });
  }
  console.log(`   ✓ Upserted ${deRegions.length} Bundesländer.`);

  // ── 2. DE Parties ─────────────────────────────────────────────────────────
  console.log("2. Seeding DE political parties...");
  const partyNow = new Date();
  for (const party of deParties) {
    const { seedOrder: _seedOrder, ...partyData } = party;
    const existing = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ name: party.name, countryId: party.countryId });

    if (existing) {
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: existing._id }, { $set: { ...partyData, updatedAt: partyNow } });
    } else {
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
  console.log(`   ✓ Upserted ${deParties.length} DE parties.`);

  // ── 3. DE Demographic Categories ──────────────────────────────────────────
  console.log("3. Seeding DE demographic categories (12 voter archetypes)...");
  for (const category of deDemographicCategories) {
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id: category._id }, { $set: category }, { upsert: true });
  }
  const groupCount = deDemographicCategories.reduce((s, c) => s + c.groups.length, 0);
  console.log(
    `   ✓ Upserted ${deDemographicCategories.length} category (${groupCount} DE voter archetypes).`
  );

  // ── 4. DE Region Demographics ─────────────────────────────────────────────
  console.log("4. Seeding DE region demographics...");
  for (const sd of deRegionDemographics) {
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id: sd._id }, { $set: sd }, { upsert: true });
    await db
      .collection<StateDemographics>("demographicDefaults")
      .updateOne({ _id: sd._id }, { $set: sd }, { upsert: true });

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
  console.log(`   ✓ Upserted ${deRegionDemographics.length} DE region demographics.`);

  // ── 5. DE Demographic Turnout ─────────────────────────────────────────────
  console.log("5. Seeding DE demographic turnout modifiers (all zeros)...");
  for (const doc of deDemographicTurnout) {
    await db
      .collection<StateDemographicTurnout>("stateDemographicTurnout")
      .updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
  }
  console.log(`   ✓ Upserted ${deDemographicTurnout.length} DE turnout modifier documents.`);

  // ── 6. DE State Party Orgs ────────────────────────────────────────────────
  console.log("6. Seeding DE state party orgs (calculated from preset polling)...");
  // Read live gameState.preset so the standalone seed respects the
  // currently-active preset (mirrors the seed* helpers in src/lib/admin/seed).
  const seedGameState = await db
    .collection<{ _id: string; preset?: string }>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  const deSeedPreset = seedGameState?.preset ?? DEFAULT_SEED_PRESET;
  const deStatePartyOrgs = await calculateDEStatePartyOrgs(db, deSeedPreset);
  const now = new Date();
  for (const org of deStatePartyOrgs) {
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne(
        { _id: org._id },
        { $set: { ...org, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
  }
  console.log(
    `   ✓ Upserted ${deStatePartyOrgs.length} DE state party org documents (calculated from vote share).`
  );

  // ── 7. DE State Metrics ───────────────────────────────────────────────────
  console.log("7. Seeding DE state metrics (Destatis per Bundesland)...");
  for (const m of deStateMetrics) {
    await db
      .collection<StateMetrics>("stateMetrics")
      .updateOne({ _id: m._id }, { $set: m }, { upsert: true });
  }
  console.log(`   ✓ Upserted ${deStateMetrics.length} DE state metrics.`);

  // ── 8. DE State Metric Baselines ──────────────────────────────────────────
  console.log("8. Seeding DE state metric baselines (resting values for decay)...");
  for (const b of deStateBaselines) {
    await db
      .collection<StateMetricBaseline>("stateMetricBaselines")
      .updateOne({ _id: b._id }, { $set: b }, { upsert: true });
  }
  console.log(`   ✓ Upserted ${deStateBaselines.length} DE state metric baselines.`);

  // ── 9. DE Government Formation ────────────────────────────────────────────
  console.log("9. Seeding DE governmentFormation document (pending Chancellor election)...");
  await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: deGovernmentFormation._id },
    {
      $set: { ...deGovernmentFormation, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  console.log("   ✓ DE government formation upserted (status: pending).");

  // ── 10. DE Legislation Types ──────────────────────────────────────────────
  console.log("10. Seeding DE legislation types (tier-1 subset)...");
  for (const type of deLegislationTypes) {
    await db
      .collection<LegislationType>("legislationTypes")
      .updateOne(
        { _id: type._id },
        { $set: { ...type, source: "seed" as const, updatedAt: now } },
        { upsert: true }
      );
  }
  console.log(`   ✓ Upserted ${deLegislationTypes.length} DE legislation types.`);

  console.log("\n=== DE Seed Complete ===");
  console.log(
    `Bundesländer: ${deRegions.length}, Parties: ${deParties.length}, ` +
      `Archetypes: ${groupCount}, Party Orgs: ${deStatePartyOrgs.length}, ` +
      `Metrics: ${deStateMetrics.length}, Baselines: ${deStateBaselines.length}, ` +
      `Legislation Types: ${deLegislationTypes.length}`
  );
}

main()
  .catch((err) => {
    console.error("DE seed failed:", err);
    process.exit(1);
  })
  .finally(closeDb);
