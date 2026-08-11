import { MongoClient } from "mongodb";
import { COST_INCOME_ANCHORS } from "@/lib/politicalLegislation/costAnchors";
import { countryFiscalBase } from "@/lib/politicalLegislation/fiscalBase";
import { nationalLawCountryQuery } from "@/lib/policy/nationalPolicyRecords";
import { getEraContext } from "@/lib/era/context";
const c = new MongoClient(process.env.SIM_MONGODB_URI!);
(async () => {
  await c.connect();
  const db = c.db("ahd_sim_grand1953");
  for (const cid of ["UK", "US"] as const) {
    const base = await countryFiscalBase(db as any, cid as any);
    const { incomeBandIndexByCountry } = await getEraContext(db as any);
    const bandIndex = incomeBandIndexByCountry?.[cid] ?? 1;
    const anchor = (COST_INCOME_ANCHORS as any)[cid];
    console.log(
      `\n=== ${cid} base.gdp=${(base.gdp / 1e9).toFixed(2)}B pop=${(base.population / 1e6).toFixed(1)}M anchor=${anchor} band=${bandIndex} impliedGpc=${(base.gdp / base.population).toFixed(0)} anchor/gpc=${(anchor / (base.gdp / base.population)).toFixed(2)}`
    );
    const laws: any[] = await db
      .collection("enactedLaws")
      .find({
        scope: "national",
        ...nationalLawCountryQuery(cid as any),
        repealedAt: { $exists: false },
      })
      .toArray();
    const rows: any[] = [];
    for (const law of laws) {
      const lv = law.costModelV2 ?? law.selectedOption?.costModelV2 ?? law.option?.costModelV2;
      if (!lv) continue;
      const g = (lv.gdpCostFraction ?? 0) * base.gdp;
      const i = (lv.incomeCostFraction ?? 0) * anchor * bandIndex * base.population;
      rows.push([law.legislationTypeId, g, i, lv.gdpCostFraction ?? 0, lv.incomeCostFraction ?? 0]);
    }
    rows.sort((a, b) => b[1] + b[2] - (a[1] + a[2]));
    console.log(` v2 laws: ${rows.length}/${laws.length}`);
    rows
      .slice(0, 6)
      .forEach((r) =>
        console.log(
          `   tot=${((r[1] + r[2]) / 1e9).toFixed(3)}B  gdpTerm=${(r[1] / 1e9).toFixed(3)}B(f=${r[3]})  incTerm=${(r[2] / 1e9).toFixed(3)}B(f=${r[4]})  ${r[0]}`
        )
      );
  }
  await c.close();
})();
