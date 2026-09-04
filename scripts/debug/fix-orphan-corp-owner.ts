/**
 * One corporation still names the dissolved shell as its state owner.
 *
 * The reversal swept `countryId`, and `countryOwnerId` is a DIFFERENT field —
 * it records which STATE owns a nationalised enterprise. A single corporation
 * kept `countryOwnerId: "DE"`, so a company owned by the unified German state
 * reads as owned by a country that no longer exists.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const rows = await db
    .collection("corporations")
    .find({ countryOwnerId: "DE" })
    .project({ name: 1, countryId: 1, countryOwnerId: 1, isNationalized: 1 })
    .toArray();

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — corporations owned by DE: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  ${String(r.name)}  countryId=${r.countryId} owner=${r.countryOwnerId} nationalised=${r.isNationalized}`
    );
  }

  if (APPLY && rows.length > 0) {
    await db
      .collection("corporations")
      .updateMany({ countryOwnerId: "DE" }, { $set: { countryOwnerId: "DD" } });
    console.log("APPLIED");
  } else if (!APPLY) {
    console.log("DRY RUN — nothing written.");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
