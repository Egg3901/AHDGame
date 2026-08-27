import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
const __d = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__d, "../../.env.local") });
let uri = process.env.MONGODB_URI_LIVE;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
const c = new MongoClient(uri);
try {
  await c.connect();
  const db = c.db();
  const cs = await db.collection("conflicts").find({}).toArray();
  console.log(`${cs.length} conflict(s)`);
  for (const x of cs) {
    console.log(
      `  ${x._id} host=${x.hostCountry} hostEntities=${JSON.stringify(x.hostEntities)} ` +
        `terrain="${x.terrain}" storedSeaAccess=${x.seaAccess === undefined ? "(absent)" : x.seaAccess} status=${x.status}`
    );
  }
  const navalAtFront = await db
    .collection("militaryUnits")
    .aggregate([
      { $match: { domain: "naval", theaterId: { $ne: "reserve" } } },
      {
        $group: {
          _id: { t: "$theaterId", c: "$countryId" },
          n: { $sum: 1 },
          men: { $sum: "$personnel" },
        },
      },
    ])
    .toArray();
  console.log(`\nnaval formations deployed to a front: ${navalAtFront.length} group(s)`);
  for (const g of navalAtFront) {
    console.log(`  ${g._id.t} ${g._id.c}: ${g.n} hulls, ${g.men.toLocaleString()} men`);
  }
  const domains = await db.collection("militaryUnits").distinct("domain");
  console.log(`\ndomains present in militaryUnits: ${JSON.stringify(domains)}`);
} finally {
  await c.close();
}
