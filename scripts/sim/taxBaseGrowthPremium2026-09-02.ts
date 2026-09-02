/**
 * Tax-base growth premium: does bounding base growth to nominal GDP fix the
 * divergence without repricing the world?
 *
 * The balance report for `TAX_BASE_GROWTH_PREMIUM_CAP` (refs #1323). Two arms,
 * same engine, same live budgets, same per-turn cadence, walked forward from the
 * live world state:
 *
 *   BEFORE  bases grow at the raw `wageGrowth` / `tradeGrowth` metrics, with only
 *           the 8%/yr gravity pull holding them to GDP (the shipped behaviour)
 *   AFTER   the same, with each rate first capped at nominal GDP growth plus the
 *           premium
 *
 * Both arms keep the gravity, the same seeds, the same GDP path and the same
 * revenue cap. The difference between them is the ceiling and nothing else.
 *
 * Why this needed a report rather than a constant: the gravity is a spring, and
 * the base/target ratio has fixed point `p / ((1+g) - (1+w)(1-p))`, finite ONLY
 * while `(1+w)(1-p) < (1+g)`. Past that line there is no equilibrium at all and
 * no pull strength short of 1 recovers it. Live DD sits past it. The question a
 * report can answer and algebra cannot is what the ceiling does to the 26
 * countries that are NOT past it, and whether it changes revenue for economies
 * that were behaving.
 *
 * Reads live budgets and metrics; writes nothing.
 *
 *   npx tsx scripts/sim/taxBaseGrowthPremium2026-09-02.ts
 *   SIM_YEARS=50 npx tsx scripts/sim/taxBaseGrowthPremium2026-09-02.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type {
  FederalBudget,
  FederalTaxBases,
  FederalTaxRates,
  EconomicGrowthFactors,
} from "@/lib/db/types/budget";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { State } from "@/lib/db/types/state";
import { getNationalDocId, NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  applyPerTurnGrowthToFederalBases,
  applyEraRevenueCap,
  normalizeFederalTaxRates,
  TAX_BASE_GDP_SHARE_GRAVITY_ANNUAL,
  TAX_BASE_GROWTH_PREMIUM_CAP,
  type TaxBaseGravityContext,
} from "@/lib/budget/revenue";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const YEARS = Number(process.env.SIM_YEARS ?? 30);
const ERA_YEAR = 1963;

type BaseKey = keyof FederalTaxBases;
const BASE_KEYS: BaseKey[] = [
  "taxableIncome",
  "domesticCorporateProfits",
  "foreignCorporateProfits",
  "wagesAndSalaries",
  "importValue",
  "taxableSales",
];

/**
 * The BEFORE arm: the growth step exactly as it shipped, with no ceiling. Kept
 * as a local replica because the capped path is now the only one in the engine,
 * and a report that compares the engine against itself would show nothing.
 * Mirrors `growFederalBases` + `pullTowardGdpShare` term for term.
 */
function growUncapped(
  bases: FederalTaxBases,
  factors: EconomicGrowthFactors,
  gravity: TaxBaseGravityContext
): FederalTaxBases {
  const n = TURNS_PER_YEAR;
  const g = (rate: number) => 1 + rate / 100 / n;
  const gdpM = g(factors.gdpGrowth);
  const wageM = g(factors.wageGrowth);
  const tradeM = g(factors.tradeGrowth);
  const corpM = g(factors.gdpGrowth + 1.0); // CAPITAL_RETURNS_PREMIUM
  const grown: FederalTaxBases = {
    taxableIncome: bases.taxableIncome * wageM,
    domesticCorporateProfits: bases.domesticCorporateProfits * corpM,
    foreignCorporateProfits: bases.foreignCorporateProfits * corpM,
    wagesAndSalaries: bases.wagesAndSalaries * wageM,
    importValue: bases.importValue * tradeM,
    taxableSales: bases.taxableSales * ((gdpM + wageM) / 2),
  };
  const pull = TAX_BASE_GDP_SHARE_GRAVITY_ANNUAL / n;
  const out = { ...grown };
  for (const key of BASE_KEYS) {
    const share = gravity.shareBaseline[key];
    if (share == null || !(share > 0) || !(gravity.currentGdp > 0)) continue;
    const target = gravity.currentGdp * share;
    out[key] = out[key] + (target - out[key]) * pull;
  }
  return out;
}

function rawTaxTake(bases: FederalTaxBases, rates: FederalTaxRates): number {
  return (
    bases.taxableIncome * (rates.incomeTax / 100) +
    bases.domesticCorporateProfits * (rates.domesticCorporateTax / 100) +
    bases.foreignCorporateProfits * (rates.foreignCorporateTax / 100) +
    bases.wagesAndSalaries * (rates.payrollTax / 100) +
    bases.importValue * (rates.tariffs / 100) +
    bases.taxableSales * (rates.salesTax / 100)
  );
}

/** Mean multiple of baseline share across the bases that have a baseline. */
function meanMultiple(
  bases: FederalTaxBases,
  gdp: number,
  shareBaseline: Partial<Record<BaseKey, number>>
): number {
  const vals: number[] = [];
  for (const key of BASE_KEYS) {
    const share = shareBaseline[key];
    if (share == null || !(share > 0) || !(gdp > 0)) continue;
    vals.push(bases[key] / gdp / share);
  }
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : Number.NaN;
}

function run(
  arm: "before" | "after",
  bases0: FederalTaxBases,
  gdp0: number,
  factors: EconomicGrowthFactors,
  shareBaseline: Partial<Record<BaseKey, number>>,
  rates: FederalTaxRates,
  countryId: string
) {
  let bases = { ...bases0 };
  let gdp = gdp0;
  for (let t = 0; t < YEARS * TURNS_PER_YEAR; t++) {
    const gravity: TaxBaseGravityContext = { currentGdp: gdp, shareBaseline };
    bases =
      arm === "after"
        ? applyPerTurnGrowthToFederalBases(bases, factors, gravity)
        : growUncapped(bases, factors, gravity);
    gdp *= (1 + factors.gdpGrowth / 100) ** (1 / TURNS_PER_YEAR);
  }
  const raw = rawTaxTake(bases, rates);
  const capped = applyEraRevenueCap(raw, gdp, ERA_YEAR, countryId);
  return {
    multiple: meanMultiple(bases, gdp, shareBaseline),
    rawShare: raw / gdp,
    cappedShare: capped / gdp,
    capLossShare: (raw - capped) / gdp,
  };
}

const pct = (v: number) => (Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "—");
const mult = (v: number) => (Number.isFinite(v) ? v.toFixed(2) + "x" : "—");

async function main() {
  let uri = process.env.MONGODB_URI_LIVE ?? "";
  if (!uri) throw new Error("MONGODB_URI_LIVE is not set");
  if (!/directConnection/.test(uri))
    uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
  const client = new MongoClient(uri);
  await client.connect();
  const db: Db = client.db();
  try {
    const [budgets, metrics, states] = await Promise.all([
      db.collection<FederalBudget>("federalBudget").find({}).toArray(),
      db.collection<StateMetrics>("macroMetrics").find({}).toArray(),
      db.collection<State>("states").find({}).toArray(),
    ]);
    const metricsById = new Map(metrics.map((m) => [String(m._id), m]));

    console.log(`Tax-base growth premium report — ${YEARS} game years, live world`);
    console.log(`premium cap = ${TAX_BASE_GROWTH_PREMIUM_CAP}pp over NOMINAL gdp growth`);
    console.log(`gravity      = ${TAX_BASE_GDP_SHARE_GRAVITY_ANNUAL} /yr (unchanged)\n`);
    console.log(
      "ctry | rates w/t/g/infl        | base multiple      | raw take %GDP     | cap loss %GDP     | binding"
    );
    console.log(
      "     |                         | before -> after    | before -> after   | before -> after   |"
    );

    const rows: string[] = [];
    for (const budget of budgets.sort((a, b) =>
      String(a.countryId).localeCompare(String(b.countryId))
    )) {
      const countryId = String(budget.countryId ?? budget._id);
      const rates = normalizeFederalTaxRates(budget.taxRates);
      const shareBaseline = budget.taxBaseGdpShareBaseline;
      if (!budget.taxBases || !rates || !shareBaseline) continue;

      const countryStates = states.filter(
        (s) => s.countryId === countryId && !NATIONAL_SCOPE_IDS.has(String(s._id))
      );
      const gdp0 = countryStates.reduce((sum, s) => sum + (s.gdp || 0), 0) * 1_000_000;
      if (!(gdp0 > 0)) continue;

      const nat = metricsById.get(getNationalDocId(countryId as never) ?? "");
      const rate = (k: "wageGrowth" | "tradeGrowth" | "gdpGrowth", d: number) => {
        const v = nat?.economic?.[k]?.value;
        return typeof v === "number" && Number.isFinite(v) ? v : d;
      };
      const inflationRate = Number.isFinite(budget.economicFactors?.inflationRate)
        ? (budget.economicFactors?.inflationRate as number)
        : 2.5;
      const factors: EconomicGrowthFactors = {
        gdpGrowth: rate("gdpGrowth", 2.5),
        wageGrowth: rate("wageGrowth", 3),
        tradeGrowth: rate("tradeGrowth", 2),
        inflationRate,
        lastUpdated: new Date(),
      };

      const ceiling = factors.gdpGrowth + Math.max(0, inflationRate) + TAX_BASE_GROWTH_PREMIUM_CAP;
      const binds = factors.wageGrowth > ceiling || factors.tradeGrowth > ceiling;

      const before = run("before", budget.taxBases, gdp0, factors, shareBaseline, rates, countryId);
      const after = run("after", budget.taxBases, gdp0, factors, shareBaseline, rates, countryId);

      rows.push(
        `${countryId.padEnd(4)} | ${factors.wageGrowth.toFixed(1).padStart(5)}/${factors.tradeGrowth
          .toFixed(1)
          .padStart(5)}/${factors.gdpGrowth.toFixed(1).padStart(5)}/${inflationRate
          .toFixed(1)
          .padStart(
            4
          )} | ${mult(before.multiple).padStart(7)} -> ${mult(after.multiple).padStart(7)} | ${pct(
          before.rawShare
        ).padStart(7)} -> ${pct(after.rawShare).padStart(7)} | ${pct(before.capLossShare).padStart(
          7
        )} -> ${pct(after.capLossShare).padStart(7)} | ${binds ? "YES" : "no"}`
      );
    }
    console.log(rows.join("\n"));
    console.log(
      "\nbinding = the ceiling is below at least one live growth rate, so this country's bases move."
    );
    console.log(
      "A country marked 'no' is untouched by this change: its rates already sit under the ceiling."
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
