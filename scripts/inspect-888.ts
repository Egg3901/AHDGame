import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const d = (u: string) => (u.includes("directConnection=") ? u : `${u}&directConnection=true`);
(async () => {
  const c = new MongoClient(d(process.env.MONGODB_URI!));
  await c.connect();
  const db = c.db();
  const ch: any =
    (await db.collection("characters").findOne({ sequentialId: 271 })) ??
    (await db.collection("characters").findOne({ name: "Bill Frist" }));
  console.log(
    "char 271:",
    ch?.name,
    "| countryId:",
    ch?.countryId,
    "| actions(energy):",
    ch?.actions,
    "| funds:",
    ch?.funds
  );
  console.log("currencyBalances:", JSON.stringify(ch?.currencyBalances));
  console.log("homeState:", ch?.homeState);
  const _rate: any = ch?.countryId
    ? await db.collection("exchangeRates").findOne({ currencyCode: undefined })
    : null;
  // fetch the home currency rate
  const _rateDoc: any = await db.collection("exchangeRates").findOne({/* placeholder */});
  // Just dump all rates small
  const rates: any[] = await db
    .collection("exchangeRates")
    .find({})
    .project({ currencyCode: 1, rate: 1 })
    .toArray();
  console.log(
    "rates:",
    rates.map((r) => `${r.currencyCode}=${Math.round(r.rate * 100) / 100}`).join(", ")
  );
  console.log(
    "\nBarnstorm gates: needs actions>=5 (has",
    ch?.actions,
    "), needs campaign funds >= 100000*homeRate"
  );
  await c.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
