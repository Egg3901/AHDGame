/**
 * Heal the stray `SU` central-bank document (GH #3038).
 *
 * `SU` is NOT a valid `CountryId` — the USSR is modelled as `RU` throughout the
 * seed stack (see `src/lib/constants/countries.ts` RU config, `seedRuBudgets`,
 * `international/ru.ts`), and `FOREX_ACTIVE_COUNTRIES` lists `RU`, never `SU`.
 * The current seed source therefore never creates an `SU` central bank; the
 * stray doc is legacy live-Mongo data from an older seed generation that keyed
 * the USSR's bank on `SU` before the RU consolidation. `getBankId("RU")`
 * resolves to `"RU"`, so the canonical id is `RU`.
 *
 * This migration reconciles any `centralBanks` doc with `_id: "SU"` (or a
 * `countryId: "SU"`) to `RU`, WITHOUT widening the CountryId type to permit SU:
 *   - if an `RU` bank doc already exists, the `SU` doc is stale → delete it;
 *   - otherwise, re-key the `SU` doc to `_id: "RU"` / `countryId: "RU"`.
 *
 * Dry-run by default (prints what it would do). Pass `--apply` to write.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-07-11-heal-stray-su-central-bank.ts          # dry-run
 *   npx tsx scripts/migrations/2026-07-11-heal-stray-su-central-bank.ts --apply  # write
 *
 * Connects to MONGODB_URI_LIVE if set, else MONGODB_URI (from .env.local).
 */
import { MongoClient, type Db } from "mongodb";
import dotenv from "dotenv";
import path from "path";
import { resolveMongoDbName } from "@/lib/mongodb";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

type CentralBankDoc = { _id: string; countryId?: string; [key: string]: unknown };

function resolveUri(): { uri: string; which: string } {
  const live = process.env.MONGODB_URI_LIVE;
  if (live) return { uri: live, which: "MONGODB_URI_LIVE" };
  const fallback = process.env.MONGODB_URI;
  if (fallback) return { uri: fallback, which: "MONGODB_URI" };
  throw new Error("Neither MONGODB_URI_LIVE nor MONGODB_URI is set in .env.local");
}

async function healStraySuCentralBank(db: Db, apply: boolean): Promise<void> {
  const centralBanks = db.collection<CentralBankDoc>("centralBanks");

  const strays = await centralBanks.find({ $or: [{ _id: "SU" }, { countryId: "SU" }] }).toArray();

  if (strays.length === 0) {
    console.log("No stray SU central-bank document found — nothing to do.");
    return;
  }

  for (const stray of strays) {
    const ruExists = (await centralBanks.countDocuments({ _id: "RU" }, { limit: 1 })) > 0;

    if (stray._id === "SU") {
      if (ruExists) {
        console.log(`SU central-bank doc is stale (RU already exists) → DELETE _id="SU"`);
        if (apply) await centralBanks.deleteOne({ _id: "SU" });
      } else {
        console.log(`Re-key SU central-bank doc → _id="RU", countryId="RU"`);
        if (apply) {
          const { _id: _drop, ...rest } = stray;
          await centralBanks.insertOne({ ...rest, _id: "RU", countryId: "RU" });
          await centralBanks.deleteOne({ _id: "SU" });
        }
      }
    } else {
      // _id is not "SU" but countryId === "SU": just correct the field.
      console.log(`Central-bank doc _id="${stray._id}" has countryId="SU" → set countryId="RU"`);
      if (apply) {
        await centralBanks.updateOne(
          { _id: stray._id },
          { $set: { countryId: "RU", updatedAt: new Date() } }
        );
      }
    }
  }

  console.log(
    apply ? "Applied SU → RU central-bank heal." : "Dry-run only — re-run with --apply to write."
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { uri, which } = resolveUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(resolveMongoDbName(process.env as Record<string, string | undefined>));
  console.log(
    `Connected via ${which} (db=${db.databaseName}); mode=${apply ? "APPLY" : "DRY-RUN"}`
  );
  try {
    await healStraySuCentralBank(db, apply);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
