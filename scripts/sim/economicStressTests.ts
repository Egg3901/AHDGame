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

async function main(mongoUri: string, selectedDbName: string): Promise<void> {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const snapshot = await client
      .db(selectedDbName)
      .collection<EconomicVitalSigns>("economicVitalSigns")
      .findOne({}, { sort: { turn: -1 } });
    if (!snapshot) throw new Error(`No economic vital-sign snapshot found in ${selectedDbName}`);
    process.stdout.write(
      `${JSON.stringify(
        {
          dbName: selectedDbName,
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
}

void main(uri, dbName).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
