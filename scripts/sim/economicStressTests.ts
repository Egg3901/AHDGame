import { MongoClient } from "mongodb";
import type { EconomicVitalSigns } from "@/lib/db/types/economicVitalSigns";
import { runEconomicStressTests } from "@/lib/economy/economicStressTests";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const uri = process.env.SIM_MONGODB_URI;
const dbName = argument("db");
if (!uri || !dbName) {
  throw new Error(
    "Usage: SIM_MONGODB_URI=... npx tsx scripts/sim/economicStressTests.ts --db=<sandbox>"
  );
}

const client = new MongoClient(uri);
try {
  await client.connect();
  const snapshot = await client
    .db(dbName)
    .collection<EconomicVitalSigns>("economicVitalSigns")
    .findOne({}, { sort: { turn: -1 } });
  if (!snapshot) throw new Error(`No economic vital-sign snapshot found in ${dbName}`);
  process.stdout.write(
    `${JSON.stringify(
      {
        dbName,
        turn: snapshot.turn,
        measurementConfidence: snapshot.measurement.confidence,
        findings: runEconomicStressTests(snapshot),
      },
      null,
      2
    )}\n`
  );
} finally {
  await client.close();
}
