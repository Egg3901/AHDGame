/**
 * Deterministic 1991 advertising sensitivity from GDP, sector weights, NPP
 * marketing rules, and current commodity production rules.
 *
 * This is not a turn simulation or a calibration proposal. Political campaign
 * ads are excluded because they do not currently buy advertising commodity.
 */
import {
  MARKETING_ADVERTISING_DEMAND_ELASTICITY,
  MARKETING_ADVERTISING_DEMAND_RATE,
  MARKETING_ADVERTISING_REFERENCE_BUDGETS_ANCHOR,
  SECTOR_SUPPLY,
} from "@/lib/constants/commodities";
import { isPlannedEconomy } from "@/lib/constants/commandEconomy";
import { getInitialRates } from "@/lib/constants/currencies";
import {
  COUNTRY_SECTOR_WEIGHTS_1991,
  getCountrySectorWeights1991,
} from "@/lib/seeds/reference/sectorSeedWeights1991";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";
import { plannedEconomyMediaSupplyFactor } from "@/lib/constants/sectorStrategies";
import type { CountryId } from "@/lib/constants/countries";

const PRESET = "1991-default";
const START_YEAR = 1991;
const DAYS_PER_YEAR = 365;
const TARGET_SUPPLY_TO_DEMAND = 0.9;
const MARKETING_BUDGET_SHARES = [0.005, 0.015, 0.03, 0.05] as const;

const rates = getInitialRates(PRESET);
const budgetConfigs = getNationalBudgetSeedConfigsForPreset(PRESET);
let anchorGdpPerDay = 0;
let marketAdvertisingSupplyValuePerDay = 0;
const countryRows: Array<{
  countryId: string;
  planned: boolean;
  anchorGdpPerDay: number;
  mediaWeight: number;
  entertainmentWeight: number;
  advertisingSupplyValuePerDay: number;
}> = [];

for (const budget of budgetConfigs) {
  const countryId = budget.countryId as CountryId;
  const fxRate = rates[countryId] ?? 1;
  const dailyGdp = budget.gdp / fxRate / DAYS_PER_YEAR;
  const weights = getCountrySectorWeights1991(countryId);
  const planned = isPlannedEconomy(countryId, START_YEAR, true);
  const mediaRate =
    SECTOR_SUPPLY.media?.find((flow) => flow.commodity === "advertising")?.rate ?? 0;
  const entertainmentRate =
    SECTOR_SUPPLY.entertainment?.find((flow) => flow.commodity === "advertising")?.rate ?? 0;
  const mediaSupplyValue = planned
    ? 0
    : dailyGdp * (weights.media ?? 0) * mediaRate * plannedEconomyMediaSupplyFactor("media", false);
  const entertainmentSupplyValue = dailyGdp * (weights.entertainment ?? 0) * entertainmentRate;
  const advertisingSupplyValuePerDay = mediaSupplyValue + entertainmentSupplyValue;

  anchorGdpPerDay += dailyGdp;
  marketAdvertisingSupplyValuePerDay += advertisingSupplyValuePerDay;
  countryRows.push({
    countryId,
    planned,
    anchorGdpPerDay: dailyGdp,
    mediaWeight: weights.media ?? 0,
    entertainmentWeight: weights.entertainment ?? 0,
    advertisingSupplyValuePerDay,
  });
}

const marketingRows = MARKETING_BUDGET_SHARES.map((budgetShare) => {
  const marketingBudgetPerDay = anchorGdpPerDay * budgetShare;
  const elasticityFactor = Math.pow(
    marketingBudgetPerDay / MARKETING_ADVERTISING_REFERENCE_BUDGETS_ANCHOR,
    MARKETING_ADVERTISING_DEMAND_ELASTICITY - 1
  );
  const currentDemandValuePerDay =
    marketingBudgetPerDay * MARKETING_ADVERTISING_DEMAND_RATE * elasticityFactor;
  const currentSupplyToDemand = marketAdvertisingSupplyValuePerDay / currentDemandValuePerDay;
  const factorForTarget =
    marketAdvertisingSupplyValuePerDay / (TARGET_SUPPLY_TO_DEMAND * currentDemandValuePerDay);

  return {
    budgetShare,
    marketingBudgetPerDay,
    elasticityFactor,
    currentDemandValuePerDay,
    currentSupplyToDemand,
    factorForTarget,
  };
});

const fmtMoney = (value: number): string => `$${(value / 1_000_000).toFixed(1)}M`;
const fmtPct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const renderTable = (
  headers: string[],
  rows: string[][],
  rightAlignedColumns: number[]
): string => {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length))
  );
  const renderRow = (cells: string[]) =>
    `| ${cells
      .map((cell, index) =>
        rightAlignedColumns.includes(index)
          ? cell.padStart(widths[index])
          : cell.padEnd(widths[index])
      )
      .join(" | ")} |`;
  const separators = widths.map((width, index) =>
    rightAlignedColumns.includes(index) ? `${"-".repeat(width - 1)}:` : "-".repeat(width)
  );
  return [renderRow(headers), renderRow(separators), ...rows.map(renderRow)].join("\n");
};

console.log(`# 1991 advertising seed calibration`);
console.log("");
console.log(
  "This deterministic sensitivity report combines the authored 1991 national budget GDP, initial exchange rates, normalized sector weights, standard advertising output rates, and the current NPP marketing-budget rule. It models annual GDP as daily income by dividing by 365. Unit ratios use money-value equivalents, so the shared advertising base-price divisor cancels."
);
console.log(
  "GDP is used as a proxy on both sides: sector weights and output rates estimate supply value, while the NPP marketing share estimates demand. The seed does not author per-corporation output revenue or turnover, so this ratio is a sensitivity only. It does not support a seed calibration or a claim that each GDP dollar is corporate turnover."
);
console.log("");
console.log(
  `Budget GDP represented: ${fmtMoney(anchorGdpPerDay)} per day across ${budgetConfigs.length} seeded national budgets.`
);
console.log(
  `Current market advertising supply: ${fmtMoney(marketAdvertisingSupplyValuePerDay)} per day at authored sector weights and current media derate.`
);
console.log(
  `The 1991 NPP healthy-margin setting uses a 3.0% marketing budget; other margin and cash states range from 0.5% to 5.0%.`
);
console.log("");
console.log(
  renderTable(
    [
      "NPP marketing share",
      "Proxy funded budget",
      "Elasticity factor",
      "Current proxy commercial S/D",
      "Illustrative multiplier for S/D 0.9",
    ],
    marketingRows.map((row) => [
      fmtPct(row.budgetShare),
      fmtMoney(row.marketingBudgetPerDay),
      row.elasticityFactor.toFixed(3),
      row.currentSupplyToDemand.toFixed(3),
      row.factorForTarget.toFixed(3),
    ]),
    [0, 1, 2, 3, 4]
  )
);
console.log("");
console.log(
  "No demand multiplier is applied. The final column is arithmetic sensitivity only: it shows the factor that would produce S/D 0.9 under each proxy case. No 0.9 target is selected. Actual media sizing requires the authored production taxonomy, and NPP demand requires authored corporate seed revenue."
);
console.log(
  "The household basket included advertising inventory and its plants cap could preserve up to 1.5 supply worth of demand regardless of corporate budget demand. Advertising is a B2B marketing input, so the household-basket correction is tracked separately; household demand for entertainment services remains separate."
);
console.log(
  "Political campaign spending is not included. The current politician Advertise action does not place demand on the commodity market, and a future political ad buyer must be calibrated as its own flow."
);
console.log(
  "The audited shortage is a 1979 live-world observation, not a 1991 seed measurement. This report is a source-based 1991 opening proxy, not a turn simulation or a claim about later endogenous NPP outcomes."
);
console.log("");
console.log("## Country inputs");
console.log("");
console.log(
  renderTable(
    [
      "Country",
      "Planned media remap",
      "Media weight",
      "Entertainment weight",
      "Advertising supply value",
    ],
    countryRows.map((row) => [
      row.countryId,
      row.planned ? "yes" : "no",
      fmtPct(row.mediaWeight),
      fmtPct(row.entertainmentWeight),
      fmtMoney(row.advertisingSupplyValuePerDay),
    ]),
    [2, 3, 4]
  )
);

if (Object.keys(COUNTRY_SECTOR_WEIGHTS_1991).length < budgetConfigs.length) {
  throw new Error("1991 sector weights do not cover every national budget seed.");
}
