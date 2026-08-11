/**
 * Read-only static validation of the market partition (no writes).
 * Builds per-country clearing books from the live lagged ledger and prints
 * projected country-level fill (book demand / book supply, capped at 1) for a
 * few headline commodities, versus the old worldwide-book fill.
 *
 *   npx tsx scripts/validate-trade-partition.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { buildCountryClearingBooks } from "@/lib/market/tradePartition";
import { buildTradeAffinity } from "@/lib/trade/tradeAffinity";
import { loadActiveFtaPairs } from "@/lib/tariffs/ftaOverrides";
import { buildNationalCommodityBalances } from "@/lib/commodity-map";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";

const FOCUS: CommodityType[] = ["steel", "vehicles", "oil", "consumer_goods"] as CommodityType[];

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI!, { directConnection: true });
  const db = client.db();

  const [cps, states, tariffs, embargoes, orgs, ftaPairs] = await Promise.all([
    db.collection("commodityPrices").find({}).toArray(),
    db
      .collection("states")
      .find({}, { projection: { _id: 1, countryId: 1 } })
      .toArray(),
    db.collection("tariffs").find({}).toArray(),
    db.collection("tradeEmbargoes").find({}).toArray(),
    db.collection("organizationMemberships").find({}).toArray(),
    loadActiveFtaPairs(db as never),
  ]);

  const stateCountryMap = new Map(states.map((s) => [String(s._id), s.countryId as string]));
  const national = new Map<CountryId, Map<CommodityType, { supply: number; demand: number }>>();
  const global = new Map<CommodityType, { supply: number; demand: number }>();
  for (const cp of cps) {
    global.set(cp.commodity, { supply: cp.globalSupply, demand: cp.globalDemand });
    const per = buildNationalCommodityBalances(cp as never, stateCountryMap);
    for (const [countryId, bal] of per) {
      if (!national.has(countryId as CountryId)) national.set(countryId as CountryId, new Map());
      national.get(countryId as CountryId)!.set(cp.commodity, bal);
    }
  }

  const blocsByCountry = new Map<string, Set<string>>();
  for (const m of orgs) {
    if (!m.countryId || !m.organizationId) continue;
    if (!blocsByCountry.has(m.countryId)) blocsByCountry.set(m.countryId, new Set());
    blocsByCountry.get(m.countryId)!.add(String(m.organizationId));
  }
  const syntheticLanes: unknown[] = [];
  if (process.env.LANES === "1") {
    const { COCOM_MEMBERS_1953, COMECON_MEMBERS_1953, STRATEGIC_COMMODITIES_1953 } =
      await import("@/lib/admin/seed/seedTradeLanes");
    const east = [...COMECON_MEMBERS_1953, "CN"];
    for (const w of COCOM_MEMBERS_1953) {
      for (const e of east) {
        for (const commodity of STRATEGIC_COMMODITIES_1953) {
          syntheticLanes.push({
            sourceCountry: w,
            targetCountry: e,
            commodity,
            direction: "both",
            mode: "block",
          });
        }
      }
      syntheticLanes.push({
        sourceCountry: w,
        targetCountry: "CN",
        commodity: "all",
        direction: "export",
        mode: "block",
      });
    }
    console.log(`(dry-run: injecting ${syntheticLanes.length} synthetic iron-curtain lanes)`);
  }
  const { affinityFor, capUnitsFor } = buildTradeAffinity({
    ftaPairs,
    blocsByCountry,
    tariffs: tariffs as never,
    embargoes: [...embargoes, ...syntheticLanes] as never,
  });
  const books = buildCountryClearingBooks({
    countries: COUNTRY_ORDER,
    nationalBalances: national,
    affinityFor,
    capUnitsFor,
  });

  console.log(`embargoes: ${embargoes.length}, tariffs: ${tariffs.length}`);
  for (const commodity of FOCUS) {
    const g = global.get(commodity);
    if (!g) continue;
    const worldFill = g.supply > 0 ? Math.min(1, g.demand / g.supply) : 0;
    console.log(
      `\n== ${commodity} (world S=${Math.round(g.supply)} D=${Math.round(g.demand)} oldFill=${worldFill.toFixed(2)}) ==`
    );
    const rows: Array<[string, number, number, number]> = [];
    for (const c of COUNTRY_ORDER) {
      const b = books.get(c)?.get(commodity);
      if (!b || b.supply <= 0) continue;
      rows.push([c, b.supply, b.demand, Math.min(1, b.demand / b.supply)]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    for (const [c, s, d, f] of rows.slice(0, 12)) {
      console.log(
        `  ${c.padEnd(4)} S=${Math.round(s).toString().padStart(10)} bookD=${Math.round(d).toString().padStart(10)} fill=${f.toFixed(2)}`
      );
    }
  }
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
// (dry-run lane projection appended by the lanes work; run with LANES=1)
