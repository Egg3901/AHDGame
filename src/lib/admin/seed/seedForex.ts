import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { GameState } from "@/lib/db/types";
import {
  seedExchangeRates,
  updateCentralBanks,
  createForexIndexes,
} from "@/lib/currency/migration";
import { seedMoneySupplyBaselines } from "@/lib/moneySupply/seed";
import { seedFomcBoards } from "@/lib/centralBank/seedFomcBoard";
import { snapshotMoneySupply } from "@/lib/moneySupply/snapshot";

/**
 * Seed the forex layer for a fresh game world:
 *
 *  - `exchangeRates`: one row per active currency at its starting rate. Upsert
 *    with `$setOnInsert` so an existing seeded rate keeps its history.
 *  - `centralBanks`: one row per forex-active country with day-one prime rate,
 *    empty rate history, and the bookkeeping fields the turn processor expects
 *    (`forexRevenue`, `tradeGrowth`, etc.). Upsert with `$setOnInsert` so an
 *    existing CB's accumulated state survives a reset.
 *  - `gameState.forexEnabled = true`: explicit, not implicit. Without this,
 *    every fund helper falls back to legacy fields and forex turn logic skips.
 *  - Forex indexes on `currencyOrders`, `exchangeRates`, etc.
 *
 * Pre-Phase-6 the only path that flipped `forexEnabled` was the admin migration
 * route (`/api/admin/forex/enable`), which also runs character + corp balance
 * conversions. Those conversions are a no-op on an empty database, but bootstrap
 * never called them — so a brand-new world started with forex off and required
 * an admin step to enable it. This seeder closes that gap.
 */
export async function seedForex(db: Db, log: (msg: string) => void, preset: string): Promise<void> {
  log("Seeding forex layer (exchange rates + central banks + indexes):");

  await seedExchangeRates(db, preset);
  log("  ✓ exchangeRates rows ensured");

  await updateCentralBanks(db);
  log("  ✓ centralBanks rows ensured");

  // Populate the FOMC committee for each bank (chair + governors as technocrat
  // NPPs, staggered terms). Idempotent; the President later nominates seats.
  await seedFomcBoards(db, 0, log);

  await seedMoneySupplyBaselines(db, preset);
  log("  ✓ money-supply baselines ensured");

  await createForexIndexes(db);
  log("  ✓ forex indexes ensured");

  await snapshotMoneySupply(db, 0);
  log("  ✓ turn-0 money-supply snapshot ensured");

  // Flip the feature flag. We only set it; we never clear it on re-run, because
  // turning forex off in a populated world would orphan currencyBalances data.
  const isPre1999Preset = ["1953-default", "1979-default", "1991-default"].includes(preset);
  const result = await db.collection<GameState>("gameState").updateOne(
    { _id: "current" },
    {
      $set: {
        forexEnabled: true,
        eurozoneEnabled: !isPre1999Preset,
        euroAdoptedCountries: isPre1999Preset ? [] : (["DE", "IE"] as CountryId[]),
        updatedAt: new Date(),
      },
    }
  );
  if (result.matchedCount === 0) {
    log("  ⚠ gameState document missing — bootstrap must run initializeGameState before seedForex");
  } else {
    log(`  ✓ gameState.forexEnabled = true, eurozoneEnabled = ${String(!isPre1999Preset)}`);
  }

  log("Forex layer seeded");
}
