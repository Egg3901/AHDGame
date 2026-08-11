import { connectDb, closeDb } from "./utils/db";
import {
  seedCNRegions,
  seedCNParties,
  seedCNDemographics,
  seedCNStateMetrics,
  seedCNBaselines,
  seedCNGovernmentFormation,
  seedCnStatePartyOrg,
  seedCnBudgets,
  seedLegislationTypes,
  seedSeats,
} from "@/lib/admin/seed";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Era preset for this one-off script. Previously each seeder's `preset`
 * parameter defaulted to "2019-default", so running this against a historical
 * world silently wrote modern data. Now explicit and overridable:
 *   SEED_PRESET=1953-default npx tsx <this script>
 */
const PRESET = process.env.SEED_PRESET ?? DEFAULT_SEED_PRESET;

/**
 * China Seed Orchestrator
 *
 * Seeds all CN game data in the correct order. Run against the target
 * database before flipping COUNTRY_CONFIGS.CN.status to "active".
 *
 * Usage:
 *   npx tsx scripts/seed-cn.ts
 *   npx tsx scripts/seed-cn.ts --reset
 *
 * Prerequisite: MONGODB_URI environment variable must be set.
 */

const RESET_FLAG = process.argv.includes("--reset");

async function main() {
  console.log("=== China Seed Orchestrator ===");
  console.log(`Reset mode: ${RESET_FLAG ? "ON" : "OFF"}\n`);

  const db = await connectDb();

  // ── 1. States (regions) ───────────────────────────────────────────────────
  await seedCNRegions(db, RESET_FLAG, console.log, PRESET);

  // ── 2. Parties ────────────────────────────────────────────────────────────
  await seedCNParties(db, console.log);

  // ── 3. Demographic categories ─────────────────────────────────────────────
  // ── 4. Region demographics ────────────────────────────────────────────────
  // ── 5. Demographic turnout ────────────────────────────────────────────────
  await seedCNDemographics(db, RESET_FLAG, console.log, PRESET);

  // ── 6. State metrics ────────────────────────────────────────────────────────
  await seedCNStateMetrics(db, RESET_FLAG, console.log, PRESET);

  // ── 7. State baselines ──────────────────────────────────────────────────────
  await seedCNBaselines(db, RESET_FLAG, console.log, PRESET);

  // ── 8. Government formation ───────────────────────────────────────────────
  await seedCNGovernmentFormation(db, console.log);

  // ── 9. Federal budget ───────────────────────────────────────────────────────
  // ── 10. Regional budgets ────────────────────────────────────────────────────
  // ── 11. Default enacted laws ────────────────────────────────────────────────
  await seedCnBudgets(db, RESET_FLAG, console.log, PRESET);

  // ── 12. Seat definitions ──────────────────────────────────────────────────
  await seedSeats(db, RESET_FLAG, console.log, PRESET);

  // ── 13. Legislation types ─────────────────────────────────────────────────
  // CN legislation types are already included in the global legislationTypes array.
  // This re-seeds ALL legislation types (US + UK + JP + DE + IE + BR + CN).
  await seedLegislationTypes(db, RESET_FLAG, console.log, PRESET);

  // ── 14. State party organization ──────────────────────────────────────────
  await seedCnStatePartyOrg(db, RESET_FLAG, console.log);

  console.log("\n=== China Seed Complete ===");
  console.log("To activate China:");
  console.log("  1. Verify seed with: npx tsx scripts/check-cn-readiness.ts");
  console.log("  2. Change COUNTRY_CONFIGS.CN.status from 'coming-soon' to 'active'");
  console.log("  3. Deploy");

  await closeDb();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
