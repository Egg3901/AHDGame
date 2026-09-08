/**
 * Confirms the era unit scale the re-pricing migration will actually use.
 *
 * The migration originally read a guessed `gameState.activePreset`, which does
 * not exist; the real field is `gameState.preset`, resolved through
 * `resolvePresetIdFromGameState`. Getting this wrong returns the MODERN scale of
 * 1 instead of ~70 for a 1953 world, which makes every unit price ~70x too high
 * and cuts ~70x more capacity than the paid basis justifies. This is the check
 * that the canonical helper resolves it correctly against the live world.
 *
 *   npx tsx scripts/debug/sv-11-era-scale-check.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { loadWorldPreset, loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { capacityPricePerUnit } from "@/lib/constants/capacityEconomy";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  let uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  if (!/directConnection=/.test(uri))
    uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const raw = await db
      .collection<{ _id: string; currentYear?: number; preset?: string; activePreset?: string }>(
        "gameState"
      )
      .findOne({ _id: "current" });
    const preset = await loadWorldPreset(db);
    const scale = await loadWorldEraUnitScale(db);
    console.log("gameState.preset       =", raw?.preset);
    console.log("gameState.activePreset =", raw?.activePreset, "(the field that does NOT exist)");
    console.log("resolved preset        =", preset);
    console.log("era unit scale         =", scale);
    console.log("currentYear            =", raw?.currentYear);
    const year = raw?.currentYear ?? 1966;
    console.log(
      "\nrare-earth unit price at the RESOLVED scale =",
      capacityPricePerUnit("extraction", year, scale, "rare_earth_mining").toFixed(2)
    );
    console.log(
      "rare-earth unit price if the scale were 1  =",
      capacityPricePerUnit("extraction", year, 1, "rare_earth_mining").toFixed(2),
      "  <- what the guessed field would have produced"
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
