import { MongoClient } from "mongodb";
import { calculateEnactedLawAnnualCost } from "@/lib/budget/costs";
import { COST_INCOME_ANCHORS } from "@/lib/politicalLegislation/costAnchors";
import { countryFiscalBase } from "@/lib/politicalLegislation/fiscalBase";
import { getEraContext } from "@/lib/era/context";
import { nationalLawCountryQuery } from "@/lib/policy/nationalPolicyRecords";

const uri = process.env.SIM_MONGODB_URI!;
const c = new MongoClient(uri);
(async () => {
  await c.connect();
  const db = c.db("ahd_sim_grand1953");
  for (const cid of ["UK", "US"]) {
    const budget: any = await db.collection("federalBudget").findOne({ countryId: cid });
    const laws: any[] = await db
      .collection("enactedLaws")
      .find({
        scope: "national",
        ...nationalLawCountryQuery(cid as any),
        repealedAt: { $exists: false },
      })
      .toArray();
    const population =
      (
        await db
          .collection("states")
          .aggregate([
            { $match: { countryId: cid } },
            { $group: { _id: null, p: { $sum: "$population" } } },
          ])
          .toArray()
      )[0]?.p ?? 0;
    const { year, incomeBandIndexByCountry } = await getEraContext(db as any);
    const v2Base =
      cid in COST_INCOME_ANCHORS ? await countryFiscalBase(db as any, cid as any) : undefined;
    const rows: [string, number][] = [];
    for (const law of laws) {
      let cost = 0;
      try {
        cost = calculateEnactedLawAnnualCost(
          law as any,
          {
            budgetCapacity: budget.revenue.total,
            gdp: budget.gdp,
            population,
            countryId: cid as any,
            nationalGdpPerCapita: population > 0 ? budget.gdp / population : undefined,
            nationalMedianIncome: undefined,
            year,
            v2Base,
            incomeBandIndex: incomeBandIndexByCountry?.[cid] ?? null,
          } as any
        );
      } catch {
        cost = NaN;
      }
      if (Number.isFinite(cost) && cost !== 0)
        rows.push([`${law.legislationTypeId}|${law.budgetCategory ?? "other"}`, cost]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    const tot = rows.reduce((s, r) => s + r[1], 0);
    console.log(
      `\n=== ${cid} === laws=${laws.length} priced=${rows.length} total=${(tot / 1e9).toFixed(2)}B  revenue=${(budget.revenue.total / 1e9).toFixed(2)}B  gdp=${(budget.gdp / 1e9).toFixed(2)}B  v2Base=${v2Base ? JSON.stringify(v2Base).slice(0, 120) : "none"}`
    );
    rows
      .slice(0, 10)
      .forEach(([k, v]) =>
        console.log(
          `   ${(v / 1e9).toFixed(3)}B  ${((100 * v) / budget.gdp).toFixed(1)}% GDP  ${k}`
        )
      );
  }
  await c.close();
})();
