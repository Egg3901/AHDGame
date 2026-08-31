import { MongoClient } from "mongodb";
import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
const uri = env
  .split(/\r?\n/)
  .find((l) => l.startsWith("MONGODB_URI_LIVE="))
  .slice("MONGODB_URI_LIVE=".length)
  .trim()
  .replace(/^"|"$/g, "");
const c = new MongoClient(
  uri.includes("directConnection")
    ? uri
    : uri + (uri.includes("?") ? "&" : "?") + "directConnection=true"
);
await c.connect();
const db = c.db();
const all = await db
  .collection("militaryUnits")
  .find(
    { domain: { $in: ["naval", "air"] } },
    { projection: { integrity: 1, supply: 1, countryId: 1, name: 1 } }
  )
  .toArray();
const bad = all.filter(
  (u) =>
    u.integrity !== undefined &&
    (!Number.isFinite(u.integrity) || u.integrity < 0 || u.integrity > 100)
);
console.log("naval/air units:", all.length, "| out-of-range or non-finite integrity:", bad.length);
for (const b of bad.slice(0, 10)) console.log("  ", b.countryId, b.name, b.integrity);
const badSup = all.filter(
  (u) => u.supply !== undefined && (!Number.isFinite(u.supply) || u.supply < 0 || u.supply > 100)
);
console.log("out-of-range or non-finite supply:", badSup.length);
for (const b of badSup.slice(0, 10)) console.log("  ", b.countryId, b.name, b.supply);
await c.close();
