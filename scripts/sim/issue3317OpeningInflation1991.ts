/**
 * #3317 deterministic 1991 opening inflation report.
 *
 * Seeds every 1991-default country with its calibrated gameplay CPI and wage
 * growth, then runs one game year of the real CPI rule, the runtime wage rule,
 * the household price index and per-turn tax-base growth in a neutral FIXED
 * environment: unemployment at NAIRU (5%), prime at neutral (3%), seeded deficit and tariff, no
 * commodity, FX, savings, policy or money-supply signal, no player action.
 * It is a rule-level projection, not a world simulation, and makes no
 * long-run claim.
 *
 * For the authored high-inflation openings it also runs the FIRST calculation
 * from the authored historical CPI and wage growth, which is what a world
 * seeded before this change computes.
 *
 * Run: npx tsx scripts/sim/issue3317OpeningInflation1991.ts > scripts/sim/issue3317OpeningInflation1991.report.md
 */
import { execSync } from "node:child_process";
import { calculateInflation } from "@/lib/budget/inflation";
import { applyPerTurnGrowthToFederalBases } from "@/lib/budget/revenue";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  advanceHouseholdPriceIndex,
  HOUSEHOLD_PRICE_INDEX_BASELINE,
} from "@/lib/economy/householdPriceIndex";
import { getInitialNationalBudgetsForPreset } from "@/lib/seeds/reference/budgets";
import { OPENING_INFLATION_BOUNDS } from "@/lib/seeds/reference/openingInflation1991";

// Neutral stance: unemployment at NAIRU, prime at the engine's default neutral rate.
const UNEMPLOYMENT = 5;
const PRIME_RATE = 3;

/** Authored historical CPI and wage growth (provenance) for calibrated openings. */
const AUTHORED: Record<string, { inflationRate: number; wageGrowth: number }> = {
  BR: { inflationRate: 480, wageGrowth: 50 },
  BG: { inflationRate: 338.45, wageGrowth: 330 },
  RO: { inflationRate: 230.62, wageGrowth: 217.7 },
  YU: { inflationRate: 164, wageGrowth: 157 },
  RU: { inflationRate: 144, wageGrowth: 138.95 },
  PL: { inflationRate: 76.77, wageGrowth: 69.75 },
  TR: { inflationRate: 66, wageGrowth: 60 },
  CS: { inflationRate: 55, wageGrowth: 42.5 },
  HU: { inflationRate: 34.82, wageGrowth: 22.93 },
};

const sha = execSync("git rev-parse HEAD").toString().trim();
const budgets = getInitialNationalBudgetsForPreset("1991-default");
const { realWageClamp, wageInflationPassthrough } = OPENING_INFLATION_BOUNDS;

function step(
  budget: (typeof budgets)[number],
  previousInflation: number,
  wageGrowth: number
): number {
  return calculateInflation({
    unemployment: UNEMPLOYMENT,
    gdpGrowth: budget.economicFactors.gdpGrowth,
    primeRate: PRIME_RATE,
    surplusToGdp: budget.gdp > 0 ? budget.surplus / budget.gdp : 0,
    tariffRate: budget.taxRates.tariffs ?? 0,
    wageGrowth,
    commodityPressure: 0,
    forexPressure: 0,
    savingsPressure: 0,
    previousInflation,
  });
}

function runtimeWage(gdpGrowth: number, laggedInflation: number): number {
  const real = Math.max(realWageClamp[0], Math.min(realWageClamp[1], gdpGrowth));
  return real + wageInflationPassthrough * laggedInflation;
}

const f2 = (n: number) => n.toFixed(2);
const lines: string[] = [
  "# #3317 1991 opening inflation: deterministic rule-level report",
  "",
  `Source: \`${sha}\`. Preset \`1991-default\`, ${budgets.length} countries.`,
  `Neutral fixed environment: unemployment ${UNEMPLOYMENT}% (NAIRU), prime ${PRIME_RATE}% (neutral), seeded deficit and tariff, no commodity/FX/savings/policy/M2 signal, no player action. Not a world simulation; no long-run claim.`,
  "",
  "| Country | Authored CPI | Authored wage | Old T1 CPI | Opening CPI | Opening wage | T1 CPI | T12 CPI | T48 CPI | T48 wage | Price index T48 | Taxable income T48 |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];

for (const budget of budgets) {
  const opening = budget.economicFactors;
  const authored = AUTHORED[budget.countryId];
  const oldFirst = authored ? step(budget, authored.inflationRate, authored.wageGrowth) : null;

  let cpi = opening.inflationRate;
  let wage = opening.wageGrowth;
  let index = HOUSEHOLD_PRICE_INDEX_BASELINE;
  let bases = budget.taxBases;
  const at: Record<number, number> = {};
  for (let turn = 1; turn <= TURNS_PER_YEAR; turn++) {
    const lagged = cpi;
    cpi = step(budget, cpi, wage);
    index = advanceHouseholdPriceIndex(index, cpi);
    bases = applyPerTurnGrowthToFederalBases(bases, {
      ...opening,
      wageGrowth: wage,
      inflationRate: cpi,
    });
    wage = runtimeWage(opening.gdpGrowth, lagged);
    if (turn === 1 || turn === 12 || turn === TURNS_PER_YEAR) at[turn] = cpi;
  }
  const income =
    budget.taxBases.taxableIncome > 0 ? bases.taxableIncome / budget.taxBases.taxableIncome : 1;
  lines.push(
    `| ${budget.countryId} | ${authored ? f2(authored.inflationRate) : "="} | ${
      authored ? f2(authored.wageGrowth) : "="
    } | ${oldFirst === null ? "-" : f2(oldFirst)} | ${f2(opening.inflationRate)} | ${f2(
      opening.wageGrowth
    )} | ${f2(at[1])} | ${f2(at[12])} | ${f2(at[TURNS_PER_YEAR])} | ${f2(wage)} | ${index.toFixed(
      3
    )} | ${income.toFixed(3)}x |`
  );
}

console.log(lines.join("\n"));
