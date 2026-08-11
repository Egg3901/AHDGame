/**
 * Sandbox seeding script — targets the Vercel staging MongoDB directly.
 *
 * Run:
 *   MONGODB_URI="mongodb+srv://..." npx tsx scripts/seed-sandbox.ts
 *
 * Covers:
 *   - Full DE seed (regions, parties, demographics, statePartyOrg, stateMetrics,
 *     baselines, governmentFormation, legislation, budgets, seats, partyBudgets,
 *     unownedSectors)
 *   - UK central bank bootstrap
 *   - DE central bank bootstrap
 *   - nppEconomyEnabled → true in gameConfig
 */

import { MongoClient, type Db } from "mongodb";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Era preset for this one-off script. Previously each seeder's `preset`
 * parameter defaulted to "2019-default", so running this against a historical
 * world silently wrote modern data. Now explicit and overridable:
 *   SEED_PRESET=1953-default npx tsx <this script>
 */
const PRESET = process.env.SEED_PRESET ?? DEFAULT_SEED_PRESET;

// ── helpers ──────────────────────────────────────────────────────────────────

const SANDBOX_URI: string = (() => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI environment variable is required. Set it to your sandbox MongoDB connection string."
    );
  }
  return uri;
})();

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function run() {
  const client = new MongoClient(SANDBOX_URI);
  await client.connect();
  const db = client.db("a-house-divided");
  log("Connected to sandbox DB");

  // ── DE regions ─────────────────────────────────────────────────────────────
  await runDERegions(db);
  await runDEParties(db);
  await runDEDemographics(db);
  await runDEStatePartyOrg(db);
  await runDEStateMetrics(db);
  await runDEBaselines(db);
  await runDEGovernmentFormation(db);
  await runDELegislation(db);
  await runDEBudgets(db);
  await runDESeats(db);
  await runDEPartyBudgets(db);
  await runDEUnownedSectors(db);
  await runDESovereignCorp(db);
  await runDEElections();

  // ── Central banks (UK + DE) ────────────────────────────────────────────────
  await ensureCentralBank(db, "UK", 3.0);
  await ensureCentralBank(db, "DE", 2.0);

  // ── gameConfig fixes ───────────────────────────────────────────────────────
  await fixGameConfig(db);

  await client.close();
  log("Done. Sandbox seeding complete.");
}

// ── DE seed steps ─────────────────────────────────────────────────────────────

async function runDERegions(db: Db) {
  const { seedDERegions } = await import("@/lib/admin/seed/seedDE");
  await seedDERegions(db, false, log, PRESET);
}

async function runDEParties(db: Db) {
  const { seedDEParties } = await import("@/lib/admin/seed/seedDE");
  await seedDEParties(db, log);
}

async function runDEDemographics(db: Db) {
  const { seedDEDemographics } = await import("@/lib/admin/seed/seedDE");
  await seedDEDemographics(db, false, log, PRESET);
}

async function runDEStatePartyOrg(db: Db) {
  const { seedDEStatePartyOrg } = await import("@/lib/admin/seed/seedDE");
  await seedDEStatePartyOrg(db, false, log);
}

async function runDEStateMetrics(db: Db) {
  const { seedDEStateMetrics } = await import("@/lib/admin/seed/seedDE");
  await seedDEStateMetrics(db, false, log, PRESET);
}

async function runDEBaselines(db: Db) {
  const { seedDEBaselines } = await import("@/lib/admin/seed/seedDE");
  await seedDEBaselines(db, false, log, PRESET);
}

async function runDEGovernmentFormation(db: Db) {
  const { seedDEGovernmentFormation } = await import("@/lib/admin/seed/seedDE");
  await seedDEGovernmentFormation(db, log, PRESET);
}

async function runDELegislation(db: Db) {
  const { seedDELegislation } = await import("@/lib/admin/seed/seedDE");
  await seedDELegislation(db, log);
}

async function runDEBudgets(db: Db) {
  const { seedDeBudgets } = await import("@/lib/admin/seed/seedDeBudgets");
  await seedDeBudgets(db, false, log, PRESET);
}

async function runDESeats(db: Db) {
  const { seedSeats } = await import("@/lib/admin/seed");
  await seedSeats(db, false, log, PRESET);
}

async function runDEPartyBudgets(db: Db) {
  const { seedPartyBudgets } = await import("@/lib/admin/seed");
  await seedPartyBudgets(db, false, log);
}

async function runDEUnownedSectors(db: Db) {
  const { seedUnownedSectors } = await import("@/lib/admin/seed");
  await seedUnownedSectors(db, log, 1, PRESET);
}

async function runDESovereignCorp(db: Db) {
  const DE_CORP_ID = "700000000000000000000031";
  const existing = await db.collection("corporations").findOne({ _id: DE_CORP_ID as any });
  if (existing) {
    log("DE sovereign corp already exists — skipping");
    return;
  }
  const now = new Date();
  await db.collection("corporations").insertOne({
    _id: DE_CORP_ID as any,
    sequentialId: 900_004,
    name: "Germany",
    description: "Country-owned sovereign issuer identity for German government debt.",
    type: "financial",
    countryId: "DE",
    ceoId: "700000000000000000000032",
    userId: "700000000000000000000033",
    headquartersState: "BE",
    liquidCapital: 0,
    marketingBudget: 0,
    marketingStrength: 0,
    logisticsBudget: 0,
    logisticsStrength: 0,
    ceoSalary: 0,
    totalShares: 0,
    sharePrice: 1,
    shareholders: [],
    publicFloat: 0,
    ceoVacant: true,
    countryOwnerId: "DE",
    hiddenFromExchange: false,
    isNationalized: false,
    createdAt: now,
    updatedAt: now,
  });
  log("Created DE sovereign corp (700...0031)");
}

async function runDEElections() {
  const { seedDEElections } = await import("@/lib/admin/seed/seedDE");
  await seedDEElections(log);
}

// ── Central bank bootstrap ─────────────────────────────────────────────────

async function ensureCentralBank(db: Db, countryId: string, defaultPrimeRate: number) {
  const existing = await db.collection("centralBanks").findOne({ _id: countryId as any });
  if (existing) {
    log(`Central bank for ${countryId} already exists — skipping`);
    return;
  }
  await db.collection("centralBanks").insertOne({
    _id: countryId as any,
    countryId,
    chairCharacterId: null,
    chairCharacterName: null,
    chairAppointedAt: null,
    chairAppointedBy: null,
    chairInfamy: null,
    chairTermExpiresAtTurn: null,
    primeRate: defaultPrimeRate,
    rateHistory: [],
    nominations: [],
    lobbyingPool: [],
    interestRateHistory: [],
    inflationHistory: [],
    gdpGrowthHistory: [],
    reserveBalance: 0,
    nationalSavingsBalance: 0,
    currentSavingsPressure: 0,
    tradeGrowth: 0,
    vacancyAwaitingAutomaticSelection: false,
    chairControlsLocked: false,
    chairSelectionPending: false,
    lastRateChangeTurn: null,
    savingsFlowHistory: [],
    treasuryTransferHistory: [],
    forexRevenue: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  log(`Created central bank for ${countryId} (primeRate: ${defaultPrimeRate})`);
}

// ── gameConfig fixes ──────────────────────────────────────────────────────────

async function fixGameConfig(db: Db) {
  const result = await db
    .collection("gameConfig")
    .updateOne({ _id: "default" as any }, { $set: { nppEconomyEnabled: true } });
  log(`gameConfig: nppEconomyEnabled → true (matched: ${result.matchedCount})`);
}

// ── run ───────────────────────────────────────────────────────────────────────

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
