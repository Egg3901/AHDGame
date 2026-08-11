import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("No MONGODB_URI");

async function main() {
  const client = new MongoClient(uri as string);
  await client.connect();
  const db = client.db("a-house-divided-sandbox");

  const cols = await db.listCollections().toArray();
  console.log(
    "Collections:",
    cols
      .map((c) => c.name)
      .sort()
      .join(", ")
  );

  for (const name of [
    "corporationSectors",
    "corporatesectors",
    "sectors",
    "corpSectors",
    "corporation_sectors",
    "corporateSectors",
  ]) {
    const count = await db
      .collection(name)
      .countDocuments()
      .catch(() => -1);
    console.log(name + ": " + count);
  }

  const nppCorps = await db.collection("corporations").find({ ceoType: "npp" }).toArray();
  console.log("\nNPP corps: " + nppCorps.length);
  for (const c of nppCorps.slice(0, 20)) {
    console.log(
      " - " +
        c.name +
        " (" +
        (c.tickerSymbol || "no ticker") +
        ") country=" +
        c.countryId +
        " ceoType=" +
        c.ceoType
    );
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
