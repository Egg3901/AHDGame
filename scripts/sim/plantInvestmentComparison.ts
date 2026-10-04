import { writeFileSync } from "node:fs";
import {
  forecastSectorInvestment,
  investmentBondReference,
  type InvestmentForecastInput,
} from "../../src/lib/corporations/investment/rules";
const base: InvestmentForecastInput = {
  units: 100,
  constructionPerUnitAnchor: 100,
  chargedPerUnitAnchor: 101,
  buildTurns: 1,
  depreciationPerTurn: 0,
  turnsPerDay: 24,
  capacityUnits: 1000,
  activeFraction: 1,
  producedUnits: 1000,
  soldUnits: 1000,
  demandGapUnits: 1000,
  revenueDailyAnchor: 24000,
  operatingCostDailyAnchor: 0,
  overheadDailyAnchor: 0,
  upkeepDailyAnchor: 0,
  taxRatePercent: 0,
};
const scenarios = [
  { name: "Full fill, one percent transfer cost", input: base },
  { name: "Twenty percent tax", input: { ...base, taxRatePercent: 20 } },
  { name: "Operating cost squeeze", input: { ...base, operatingCostDailyAnchor: 12000 } },
  { name: "No unmet demand", input: { ...base, demandGapUnits: 0 } },
  { name: "Operating loss", input: { ...base, operatingCostDailyAnchor: 30000 } },
];
const reference = investmentBondReference(
  { couponRate: 6, marketPrice: 1, maturityTurn: 58, currencyCode: "USD", issuerName: "Treasury" },
  "USD",
  10
)!;
const rows = scenarios.map(({ name, input }) => {
  const points = forecastSectorInvestment(input)!;
  const last = points[2];
  return `| ${name} | ${points[0].availableCashAnchor.toFixed(2)} | ${points[1].availableCashAnchor.toFixed(2)} | ${last.availableCashAnchor.toFixed(2)} | ${last.cashPaybackTurn ?? "Not within 192"} |`;
});
writeFileSync(
  "scripts/sim/reports/plant-investment-comparison.md",
  `# Plant cash payback and sovereign reference

Generated with production investment and bond yield rules. Synthetic fixed prices and demand, no world simulation or live data. Initial charged cash is 10,100, including a 100 transfer cost; remaining plant basis is 10,000 and does not enter payback.

| Scenario | Cash after 48 turns | Cash after 96 turns | Cash after 192 turns | First cash payback turn |
| --- | ---: | ---: | ---: | ---: |
${rows.join("\n")}

Same-currency short sovereign reference: ${reference.annualYieldPercent.toFixed(2)}% annual yield at par, ${reference.turnsToMaturity} turns to maturity. This is an annual quote reference, not a cumulative cash return, execution price or guarantee. Fees, default and future reinvestment yields are excluded; returned principal is not income. Missing or foreign-currency quotes return no reference.
`
);
