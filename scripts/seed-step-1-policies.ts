import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const URI = process.env.MONGODB_URI;
if (!URI) throw new Error("No MONGODB_URI");

async function run() {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db();
  console.log("Connected");

  const { seedStatePolicies } = await import("@/lib/admin/seed/seedStatePolicies");
  await seedStatePolicies(db, false, console.log);
  console.log("seedStatePolicies done");

  await client.close();
}

run().catch(console.error);
