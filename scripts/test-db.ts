import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const URI = process.env.MONGODB_URI;
if (!URI) throw new Error("No MONGODB_URI");

async function test() {
  console.log("Connecting...");
  const client = new MongoClient(URI);
  await client.connect();
  console.log("Connected");
  const db = client.db();
  const collections = await db.listCollections().toArray();
  console.log("Collections:", collections.map((c) => c.name).join(", "));
  await client.close();
  console.log("Done");
}

test().catch(console.error);
