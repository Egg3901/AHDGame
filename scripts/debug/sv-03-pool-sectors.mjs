import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
const __d = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__d, "../../.env.local") });
let uri = process.env.MONGODB_URI_LIVE;
if (!uri.includes("directConnection"))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
const client = new MongoClient(uri);
const M = (n) =>
  n == null ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
try {
  await client.connect();
  const db = client.db();

  const names = (await db.listCollections().toArray()).map((c) => c.name);
  console.log("=== equity-pool-ish collections ===");
  console.log(names.filter((n) => /equity|pool/i.test(n)).join("\n") || "(none)");

  for (const n of names.filter((n) => /equity|pool/i.test(n))) {
    const docs = await db.collection(n).find({}).limit(20).toArray();
    console.log(`\n--- ${n} (${docs.length}) ---`);
    for (const d of docs) console.log(JSON.stringify(d));
  }

  const tt = await db.collection("corporations").findOne({ sequentialId: 738 });
  console.log("\n===== CORP 738 corporateSectors =====");
  const secs = await db.collection("corporateSectors").find({ corporationId: tt._id }).toArray();
  console.log("count", secs.length);
  for (const s of secs) {
    console.log(JSON.stringify(s, null, 1).slice(0, 2500));
  }
} finally {
  await client.close();
}
