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
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  console.log("TURN", gs?.currentTurn, "YEAR", gs?.currentYear, "week", gs?.currentWeek);

  console.log("\n===== TOP 25 PUBLIC CORPS BY SHARE PRICE =====");
  const corps = await db
    .collection("corporations")
    .find(
      { isPublic: true },
      {
        projection: {
          name: 1,
          ticker: 1,
          countryId: 1,
          sharePrice: 1,
          fundamentalSharePrice: 1,
          totalShares: 1,
          liquidCapital: 1,
          type: 1,
          dissolvedTurn: 1,
        },
      }
    )
    .sort({ sharePrice: -1 })
    .limit(25)
    .toArray();
  for (const c of corps) {
    console.log(
      `${String(c._id).padEnd(6)} ${String(c.ticker || "").padEnd(6)} ${String(c.name).slice(0, 26).padEnd(26)} ${c.countryId} px=${M(c.sharePrice)} fund=${M(c.fundamentalSharePrice)} sh=${M(c.totalShares)} cash=${M(c.liquidCapital)} mcap=${M((c.sharePrice || 0) * (c.totalShares || 0))}`
    );
  }

  console.log("\n===== CORP 738 (Tinky 3.0) FULL DOC =====");
  const tt =
    (await db.collection("corporations").findOne({ _id: 738 })) ||
    (await db.collection("corporations").findOne({ name: /Tinky/i }));
  if (tt) {
    for (const k of Object.keys(tt).sort()) {
      const v = tt[k];
      if (Array.isArray(v)) console.log(`  ${k}: [array len ${v.length}]`);
      else if (v && typeof v === "object")
        console.log(`  ${k}: {${Object.keys(v).slice(0, 14).join(",")}}`);
      else console.log(`  ${k}: ${v}`);
    }
  } else {
    console.log("  NOT FOUND");
  }
} finally {
  await client.close();
}
