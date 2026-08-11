import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const URI = process.env.MONGODB_URI;
if (!URI) throw new Error("No MONGODB_URI");

async function run() {
  const client = new MongoClient(URI);
  await client.connect();
  console.log("Connected");

  const { basePolicies } = await import("@/lib/seeds/reference/basePolicies");
  console.log("basePolicies count:", basePolicies.length);

  const { legislationTypes } = await import("@/lib/seeds/reference/legislationTypes");
  console.log("legislationTypes count:", legislationTypes.length);

  await client.close();
  console.log("Done");
}

run().catch(console.error);
