/**
 * Migration: Replace UK demographic archetypes
 *
 * Renames the 12 UK voter group IDs in stateDemographics and
 * stateDemographicTurnout to match the new archetype design.
 *
 * Old → New ID mapping:
 *   northern_working_class   → post_industrial_workers
 *   london_progressives      → urban_progressives
 *   middle_england           → suburban_homeowners
 *   young_city_professionals → young_renters
 *   rural_conservatives      → rural_traditionalists
 *   lib_dem_centrists        → moderate_centrists
 *   reform_populists         → populist_right
 *   green_left               → green_activists
 *   scottish_nationalists    → retirees         (new archetype, new populations)
 *   welsh_communities        → public_sector    (new archetype, new populations)
 *   ni_unionists             → small_business   (new archetype, new populations)
 *   ni_nationalists          → new_britons      (new archetype, new populations)
 *
 * For stateDemographics: replaces the entire groups object for each UK region
 * with redesigned population distributions (see ukRegionDemographics.ts).
 *
 * For stateDemographicTurnout: renames keys inside modifiers.uk_voterGroups,
 * preserving any existing GOTV modifier values for the renamed groups.
 * The 4 brand-new archetypes (retirees, public_sector, small_business,
 * new_britons) start at 0 since they had no prior modifier history.
 */

import { connectDb, closeDb } from "../utils/db";

// New region demographics (mirrors ukRegionDemographics.ts)
const NEW_REGION_GROUPS: Record<string, Record<string, unknown>> = {
  UK_LON: {
    post_industrial_workers: { population: 6, economicLean: -2, socialLean: 1, turnout: 52 },
    urban_progressives: { population: 20, economicLean: -3, socialLean: -4, turnout: 74 },
    suburban_homeowners: { population: 7, economicLean: 2, socialLean: 1, turnout: 68 },
    young_renters: { population: 17, economicLean: -1, socialLean: -4, turnout: 58 },
    rural_traditionalists: { population: 2, economicLean: 3, socialLean: 3, turnout: 65 },
    retirees: { population: 5, economicLean: 1, socialLean: 2, turnout: 70 },
    public_sector: { population: 9, economicLean: -3, socialLean: -2, turnout: 68 },
    moderate_centrists: { population: 8, economicLean: 0, socialLean: -2, turnout: 67 },
    populist_right: { population: 5, economicLean: 1, socialLean: 3, turnout: 50 },
    green_activists: { population: 5, economicLean: -4, socialLean: -5, turnout: 63 },
    small_business: { population: 4, economicLean: 3, socialLean: 1, turnout: 68 },
    new_britons: { population: 12, economicLean: -2, socialLean: -1, turnout: 50 },
  },
  UK_SEE: {
    post_industrial_workers: { population: 10, economicLean: -2, socialLean: 2, turnout: 55 },
    urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 70 },
    suburban_homeowners: { population: 18, economicLean: 2, socialLean: 2, turnout: 72 },
    young_renters: { population: 9, economicLean: -1, socialLean: -4, turnout: 55 },
    rural_traditionalists: { population: 13, economicLean: 3, socialLean: 3, turnout: 73 },
    retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 74 },
    public_sector: { population: 4, economicLean: -3, socialLean: -2, turnout: 67 },
    moderate_centrists: { population: 11, economicLean: 0, socialLean: -2, turnout: 68 },
    populist_right: { population: 8, economicLean: 1, socialLean: 4, turnout: 55 },
    green_activists: { population: 1, economicLean: -4, socialLean: -5, turnout: 60 },
    small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 71 },
    new_britons: { population: 2, economicLean: -2, socialLean: -1, turnout: 48 },
  },
  UK_SWE: {
    post_industrial_workers: { population: 9, economicLean: -2, socialLean: 2, turnout: 55 },
    urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 68 },
    suburban_homeowners: { population: 12, economicLean: 2, socialLean: 2, turnout: 70 },
    young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 53 },
    rural_traditionalists: { population: 16, economicLean: 3, socialLean: 3, turnout: 73 },
    retirees: { population: 13, economicLean: 1, socialLean: 3, turnout: 75 },
    public_sector: { population: 4, economicLean: -3, socialLean: -2, turnout: 66 },
    moderate_centrists: { population: 14, economicLean: 0, socialLean: -2, turnout: 68 },
    populist_right: { population: 7, economicLean: 1, socialLean: 4, turnout: 56 },
    green_activists: { population: 4, economicLean: -4, socialLean: -5, turnout: 62 },
    small_business: { population: 6, economicLean: 3, socialLean: 1, turnout: 70 },
    new_britons: { population: 2, economicLean: -2, socialLean: -1, turnout: 47 },
  },
  UK_EAE: {
    post_industrial_workers: { population: 11, economicLean: -2, socialLean: 2, turnout: 55 },
    urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 68 },
    suburban_homeowners: { population: 16, economicLean: 2, socialLean: 2, turnout: 71 },
    young_renters: { population: 9, economicLean: -1, socialLean: -3, turnout: 53 },
    rural_traditionalists: { population: 14, economicLean: 3, socialLean: 3, turnout: 72 },
    retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 74 },
    public_sector: { population: 4, economicLean: -3, socialLean: -2, turnout: 66 },
    moderate_centrists: { population: 10, economicLean: 0, socialLean: -2, turnout: 67 },
    populist_right: { population: 9, economicLean: 1, socialLean: 4, turnout: 56 },
    green_activists: { population: 1, economicLean: -4, socialLean: -5, turnout: 60 },
    small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 70 },
    new_britons: { population: 2, economicLean: -2, socialLean: -1, turnout: 46 },
  },
  UK_EMI: {
    post_industrial_workers: { population: 18, economicLean: -2, socialLean: 2, turnout: 57 },
    urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 66 },
    suburban_homeowners: { population: 13, economicLean: 2, socialLean: 2, turnout: 70 },
    young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 50 },
    rural_traditionalists: { population: 11, economicLean: 3, socialLean: 3, turnout: 72 },
    retirees: { population: 10, economicLean: 1, socialLean: 3, turnout: 73 },
    public_sector: { population: 4, economicLean: -3, socialLean: -2, turnout: 65 },
    moderate_centrists: { population: 7, economicLean: 0, socialLean: -2, turnout: 65 },
    populist_right: { population: 10, economicLean: 1, socialLean: 4, turnout: 57 },
    green_activists: { population: 2, economicLean: -4, socialLean: -5, turnout: 60 },
    small_business: { population: 5, economicLean: 3, socialLean: 1, turnout: 68 },
    new_britons: { population: 7, economicLean: -2, socialLean: -1, turnout: 48 },
  },
  UK_WMI: {
    post_industrial_workers: { population: 17, economicLean: -2, socialLean: 2, turnout: 57 },
    urban_progressives: { population: 8, economicLean: -3, socialLean: -3, turnout: 68 },
    suburban_homeowners: { population: 12, economicLean: 2, socialLean: 2, turnout: 70 },
    young_renters: { population: 10, economicLean: -1, socialLean: -3, turnout: 52 },
    rural_traditionalists: { population: 7, economicLean: 3, socialLean: 3, turnout: 71 },
    retirees: { population: 9, economicLean: 1, socialLean: 3, turnout: 72 },
    public_sector: { population: 5, economicLean: -3, socialLean: -2, turnout: 66 },
    moderate_centrists: { population: 6, economicLean: 0, socialLean: -2, turnout: 65 },
    populist_right: { population: 10, economicLean: 1, socialLean: 4, turnout: 57 },
    green_activists: { population: 2, economicLean: -4, socialLean: -5, turnout: 60 },
    small_business: { population: 4, economicLean: 3, socialLean: 1, turnout: 67 },
    new_britons: { population: 10, economicLean: -2, socialLean: -1, turnout: 49 },
  },
  UK_YHU: {
    post_industrial_workers: { population: 18, economicLean: -2, socialLean: 2, turnout: 58 },
    urban_progressives: { population: 7, economicLean: -3, socialLean: -3, turnout: 67 },
    suburban_homeowners: { population: 10, economicLean: 2, socialLean: 2, turnout: 69 },
    young_renters: { population: 9, economicLean: -1, socialLean: -3, turnout: 52 },
    rural_traditionalists: { population: 10, economicLean: 3, socialLean: 3, turnout: 71 },
    retirees: { population: 11, economicLean: 1, socialLean: 3, turnout: 73 },
    public_sector: { population: 5, economicLean: -3, socialLean: -2, turnout: 66 },
    moderate_centrists: { population: 6, economicLean: 0, socialLean: -2, turnout: 65 },
    populist_right: { population: 13, economicLean: 1, socialLean: 4, turnout: 57 },
    green_activists: { population: 2, economicLean: -4, socialLean: -5, turnout: 61 },
    small_business: { population: 3, economicLean: 3, socialLean: 1, turnout: 67 },
    new_britons: { population: 6, economicLean: -2, socialLean: -1, turnout: 48 },
  },
  UK_NWE: {
    post_industrial_workers: { population: 20, economicLean: -2, socialLean: 2, turnout: 58 },
    urban_progressives: { population: 9, economicLean: -3, socialLean: -3, turnout: 68 },
    suburban_homeowners: { population: 9, economicLean: 2, socialLean: 2, turnout: 69 },
    young_renters: { population: 10, economicLean: -1, socialLean: -3, turnout: 52 },
    rural_traditionalists: { population: 7, economicLean: 3, socialLean: 3, turnout: 70 },
    retirees: { population: 11, economicLean: 1, socialLean: 3, turnout: 72 },
    public_sector: { population: 4, economicLean: -3, socialLean: -2, turnout: 66 },
    moderate_centrists: { population: 6, economicLean: 0, socialLean: -2, turnout: 65 },
    populist_right: { population: 12, economicLean: 1, socialLean: 4, turnout: 56 },
    green_activists: { population: 3, economicLean: -4, socialLean: -5, turnout: 61 },
    small_business: { population: 2, economicLean: 3, socialLean: 1, turnout: 66 },
    new_britons: { population: 7, economicLean: -2, socialLean: -1, turnout: 49 },
  },
  UK_NEE: {
    post_industrial_workers: { population: 25, economicLean: -3, socialLean: 2, turnout: 57 },
    urban_progressives: { population: 7, economicLean: -3, socialLean: -3, turnout: 66 },
    suburban_homeowners: { population: 8, economicLean: 2, socialLean: 2, turnout: 68 },
    young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 50 },
    rural_traditionalists: { population: 7, economicLean: 3, socialLean: 3, turnout: 70 },
    retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 72 },
    public_sector: { population: 5, economicLean: -3, socialLean: -2, turnout: 65 },
    moderate_centrists: { population: 5, economicLean: 0, socialLean: -2, turnout: 63 },
    populist_right: { population: 16, economicLean: 1, socialLean: 4, turnout: 58 },
    green_activists: { population: 3, economicLean: -4, socialLean: -5, turnout: 62 },
    small_business: { population: 2, economicLean: 3, socialLean: 1, turnout: 65 },
    new_britons: { population: 2, economicLean: -2, socialLean: -1, turnout: 46 },
  },
  UK_SCO: {
    post_industrial_workers: { population: 17, economicLean: -2, socialLean: 1, turnout: 62 },
    urban_progressives: { population: 13, economicLean: -3, socialLean: -3, turnout: 68 },
    suburban_homeowners: { population: 9, economicLean: 2, socialLean: 2, turnout: 68 },
    young_renters: { population: 11, economicLean: -1, socialLean: -3, turnout: 55 },
    rural_traditionalists: { population: 9, economicLean: 3, socialLean: 3, turnout: 68 },
    retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 73 },
    public_sector: { population: 7, economicLean: -3, socialLean: -2, turnout: 67 },
    moderate_centrists: { population: 9, economicLean: 0, socialLean: -2, turnout: 65 },
    populist_right: { population: 4, economicLean: 1, socialLean: 3, turnout: 50 },
    green_activists: { population: 4, economicLean: -4, socialLean: -5, turnout: 62 },
    small_business: { population: 3, economicLean: 3, socialLean: 1, turnout: 67 },
    new_britons: { population: 2, economicLean: -2, socialLean: -1, turnout: 47 },
  },
  UK_WAL: {
    post_industrial_workers: { population: 18, economicLean: -3, socialLean: 1, turnout: 60 },
    urban_progressives: { population: 8, economicLean: -3, socialLean: -3, turnout: 66 },
    suburban_homeowners: { population: 9, economicLean: 2, socialLean: 2, turnout: 68 },
    young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 50 },
    rural_traditionalists: { population: 13, economicLean: 3, socialLean: 3, turnout: 70 },
    retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 72 },
    public_sector: { population: 14, economicLean: -3, socialLean: -2, turnout: 67 },
    moderate_centrists: { population: 5, economicLean: 0, socialLean: -2, turnout: 62 },
    populist_right: { population: 7, economicLean: 1, socialLean: 4, turnout: 55 },
    green_activists: { population: 3, economicLean: -4, socialLean: -5, turnout: 60 },
    small_business: { population: 2, economicLean: 3, socialLean: 1, turnout: 65 },
    new_britons: { population: 1, economicLean: -2, socialLean: -1, turnout: 45 },
  },
  UK_NIR: {
    post_industrial_workers: { population: 18, economicLean: -2, socialLean: 2, turnout: 58 },
    urban_progressives: { population: 10, economicLean: -3, socialLean: -3, turnout: 62 },
    suburban_homeowners: { population: 6, economicLean: 2, socialLean: 2, turnout: 62 },
    young_renters: { population: 8, economicLean: -1, socialLean: -2, turnout: 50 },
    rural_traditionalists: { population: 8, economicLean: 3, socialLean: 3, turnout: 65 },
    retirees: { population: 7, economicLean: 1, socialLean: 3, turnout: 68 },
    public_sector: { population: 5, economicLean: -3, socialLean: -2, turnout: 65 },
    moderate_centrists: { population: 14, economicLean: 0, socialLean: -2, turnout: 64 },
    populist_right: { population: 20, economicLean: 1, socialLean: 4, turnout: 63 },
    green_activists: { population: 1, economicLean: -4, socialLean: -5, turnout: 58 },
    small_business: { population: 2, economicLean: 3, socialLean: 1, turnout: 62 },
    new_britons: { population: 1, economicLean: -2, socialLean: -1, turnout: 44 },
  },
};

// Maps old archetype IDs to new IDs for turnout modifier key rename
const OLD_TO_NEW_ID: Record<string, string> = {
  northern_working_class: "post_industrial_workers",
  london_progressives: "urban_progressives",
  middle_england: "suburban_homeowners",
  young_city_professionals: "young_renters",
  rural_conservatives: "rural_traditionalists",
  lib_dem_centrists: "moderate_centrists",
  reform_populists: "populist_right",
  green_left: "green_activists",
  // Brand-new archetypes below — old groups had no meaningful modifier values
  scottish_nationalists: "retirees",
  welsh_communities: "public_sector",
  ni_unionists: "small_business",
  ni_nationalists: "new_britons",
};

// New groups array for the demographicCategories collection
const NEW_CATEGORY_GROUPS = [
  {
    id: "post_industrial_workers",
    name: "Post-Industrial Workers",
    defaultEconomicLean: -2,
    defaultSocialLean: 2,
    defaultTurnout: 57,
  },
  {
    id: "urban_progressives",
    name: "Urban Progressives",
    defaultEconomicLean: -3,
    defaultSocialLean: -4,
    defaultTurnout: 72,
  },
  {
    id: "suburban_homeowners",
    name: "Suburban Homeowners",
    defaultEconomicLean: 2,
    defaultSocialLean: 2,
    defaultTurnout: 70,
  },
  {
    id: "young_renters",
    name: "Young Renters",
    defaultEconomicLean: -1,
    defaultSocialLean: -4,
    defaultTurnout: 52,
  },
  {
    id: "rural_traditionalists",
    name: "Rural Traditionalists",
    defaultEconomicLean: 3,
    defaultSocialLean: 3,
    defaultTurnout: 71,
  },
  {
    id: "retirees",
    name: "Retirees & Pensioners",
    defaultEconomicLean: 1,
    defaultSocialLean: 3,
    defaultTurnout: 73,
  },
  {
    id: "public_sector",
    name: "Public Sector & NHS",
    defaultEconomicLean: -3,
    defaultSocialLean: -2,
    defaultTurnout: 68,
  },
  {
    id: "moderate_centrists",
    name: "Moderate Centrists",
    defaultEconomicLean: 0,
    defaultSocialLean: -2,
    defaultTurnout: 67,
  },
  {
    id: "populist_right",
    name: "Populist Right",
    defaultEconomicLean: 1,
    defaultSocialLean: 4,
    defaultTurnout: 55,
  },
  {
    id: "green_activists",
    name: "Green & Climate Activists",
    defaultEconomicLean: -4,
    defaultSocialLean: -5,
    defaultTurnout: 61,
  },
  {
    id: "small_business",
    name: "Small Business & Self-Employed",
    defaultEconomicLean: 3,
    defaultSocialLean: 1,
    defaultTurnout: 70,
  },
  {
    id: "new_britons",
    name: "New Britons & Minorities",
    defaultEconomicLean: -2,
    defaultSocialLean: -1,
    defaultTurnout: 50,
  },
];

async function migrate() {
  console.log("Starting UK archetype migration...");
  const db = await connectDb();

  const UK_REGIONS = Object.keys(NEW_REGION_GROUPS);

  // ── demographicCategories: replace groups array for uk_voterGroups ───────────
  console.log("\n0. Updating demographicCategories...");

  const catResult = await db
    .collection("demographicCategories")
    .updateOne({ _id: "uk_voterGroups" } as any, { $set: { groups: NEW_CATEGORY_GROUPS } });
  console.log(`  ✓ demographicCategories updated (modified: ${catResult.modifiedCount})`);

  // ── stateDemographics: replace groups object for each UK region ─────────────
  console.log("\n1. Updating stateDemographics groups...");
  let demographicsUpdated = 0;
  for (const regionId of UK_REGIONS) {
    const groups = NEW_REGION_GROUPS[regionId];
    const result = await db
      .collection("stateDemographics")
      .updateOne({ _id: regionId } as any, { $set: { groups, lastUpdated: new Date() } });
    if (result.modifiedCount > 0) demographicsUpdated++;
    else console.warn(`  ⚠ ${regionId}: no document found or not modified`);
  }
  console.log(`  ✓ ${demographicsUpdated}/${UK_REGIONS.length} stateDemographics updated`);

  // ── stateDemographicTurnout: rename keys in modifiers.uk_voterGroups ────────
  console.log("\n2. Updating stateDemographicTurnout modifier keys...");
  let turnoutUpdated = 0;
  for (const regionId of UK_REGIONS) {
    const doc = await db.collection("stateDemographicTurnout").findOne({ _id: regionId } as any);

    if (!doc) {
      console.warn(`  ⚠ ${regionId}: no turnout document found`);
      continue;
    }

    const oldModifiers: Record<string, number> =
      (doc.modifiers as Record<string, Record<string, number>>)?.uk_voterGroups ?? {};

    // Build new modifiers object by remapping old keys to new keys
    const newModifiers: Record<string, number> = {};
    for (const [oldId, newId] of Object.entries(OLD_TO_NEW_ID)) {
      newModifiers[newId] = oldModifiers[oldId] ?? 0;
    }

    const result = await db
      .collection("stateDemographicTurnout")
      .updateOne({ _id: regionId } as any, {
        $set: {
          "modifiers.uk_voterGroups": newModifiers,
          lastUpdated: new Date(),
        },
      });
    if (result.modifiedCount > 0) turnoutUpdated++;
    else console.warn(`  ⚠ ${regionId}: turnout document not modified`);
  }
  console.log(`  ✓ ${turnoutUpdated}/${UK_REGIONS.length} stateDemographicTurnout updated`);

  await closeDb();
  console.log("\nMigration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
