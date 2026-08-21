/**
 * Real treasury and per-turn fiscal position for the four German Question
 * seats, so the balance sim can be bounded by money the world actually has
 * rather than by the mockup's on-hand figures.
 *
 * Targets MONGODB_URI (testing) unless `--live` is passed.
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const live = process.argv.includes("--live");
const SEATS = ["US", "UK", "RU", "DD"];
const TURNS_PER_YEAR = 48;

async function main() {
  const uri = live ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
  if (!uri) throw new Error("no URI");
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    console.log("countryId  treasuryBalance        surplus/yr        surplus/turn");
    for (const id of SEATS) {
      const b = (await db.collection("federalBudget").findOne({ countryId: id })) as Record<
        string,
        unknown
      > | null;
      if (!b) {
        console.log(`${id.padEnd(10)} (no federalBudget row)`);
        continue;
      }
      const treasury = Number(b.treasuryBalance ?? 0);
      const surplus = Number(b.surplus ?? 0);
      console.log(
        `${id.padEnd(10)} ${treasury.toExponential(4).padEnd(22)} ${surplus
          .toExponential(4)
          .padEnd(17)} ${(surplus / TURNS_PER_YEAR).toExponential(4)}`
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
