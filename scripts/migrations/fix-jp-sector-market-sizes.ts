/**
 * One-time migration: correct JP unownedSectors.revenue values.
 *
 * JP GDP is stored in JPY millions. The sector formula previously treated
 * these as USD millions, inflating JP sector revenues by ~106×.
 * This migration recomputes revenue using the 2020 JPY/USD rate (0.00943)
 * now stored in CountryConfig.usdExchangeRate.
 *
 * Run: npx tsx scripts/migrations/fix-jp-sector-market-sizes.ts
 * Requires: MONGODB_URI in .env.local
 */

import { connectDb, closeDb } from "../utils/db";
import {
  SECTOR_MARKET_GDP_FRACTION,
  SECTOR_TYPE_COUNT,
} from "../../src/lib/constants/corporations";
import { getCountryConfig } from "../../src/lib/constants/countries";
import type { State } from "../../src/lib/db/types/state";
import type { UnownedSector } from "../../src/lib/db/types";

const REVENUE_MULTIPLIER = 1.25;
const MIN_REVENUE = 1_000_000;

async function main() {
  const db = await connectDb();

  const jpStates = await db
    .collection<State>("states")
    .find({ countryId: "JP", _id: { $not: /^NATIONAL_/ } })
    .toArray();

  console.log(`Found ${jpStates.length} JP states`);

  const { usdExchangeRate } = getCountryConfig("JP");
  let totalUpdated = 0;

  for (const state of jpStates) {
    const baseMarket = Math.round(
      (state.gdp * usdExchangeRate * SECTOR_MARKET_GDP_FRACTION) / SECTOR_TYPE_COUNT
    );
    const correctedRevenue = Math.round(
      Math.max(MIN_REVENUE, Math.round(baseMarket * REVENUE_MULTIPLIER))
    );

    const result = await db
      .collection<UnownedSector>("unownedSectors")
      .updateMany(
        { countryId: "JP", stateId: state._id as string },
        { $set: { revenue: correctedRevenue, updatedAt: new Date() } }
      );

    totalUpdated += result.modifiedCount;
    console.log(
      `  ${state._id}: revenue=${correctedRevenue.toLocaleString()} (${result.modifiedCount} sectors updated)`
    );
  }

  console.log(`\nDone. Total sectors updated: ${totalUpdated}`);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
