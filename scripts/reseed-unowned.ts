import { connectDb, closeDb } from "./utils/db";
import { seedUnownedSectors } from "../src/lib/admin/seed/seedUnownedSectors";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Era preset for this one-off script. Previously each seeder's `preset`
 * parameter defaulted to "2019-default", so running this against a historical
 * world silently wrote modern data. Now explicit and overridable:
 *   SEED_PRESET=1953-default npx tsx <this script>
 */
const PRESET = process.env.SEED_PRESET ?? DEFAULT_SEED_PRESET;

async function main() {
  const db = await connectDb();
  const before = await db.collection("unownedSectors").countDocuments();
  console.log("before:", before);
  const del = await db.collection("unownedSectors").deleteMany({});
  console.log("deleted:", del.deletedCount);
  await seedUnownedSectors(db, (m) => console.log("[seed]", m), 1, PRESET);
  const after = await db.collection("unownedSectors").countDocuments();
  console.log("after:", after);
  const ldn = await db.collection("unownedSectors").findOne({ stateId: "LON" });
  const ca = await db.collection("unownedSectors").findOne({ stateId: "CA" });
  console.log("London per-sector rev:", ldn?.revenue);
  console.log("California per-sector rev:", ca?.revenue);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
