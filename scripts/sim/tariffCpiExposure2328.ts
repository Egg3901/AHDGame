/**
 * Deterministic narrow sensitivity for issue #2328. Exercises the production
 * sourcing allocator and actual CPI breakdown without DB or world simulation.
 */
import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";
import { calculateInflationWithBreakdown, type InflationInputs } from "@/lib/budget/inflation";
import { runSourcingPass, type SourcingInputs } from "@/lib/logistics/sourcing";
import { tariffInflationExposure } from "@/lib/tariffs/rules/tariffInflationExposure";

const TOTAL_DEMAND = 100;
const PRICE = 100;
const importAvailabilityShares = [0, 0.25, 0.8, 1] as const;
const tariffRates = [0, 3, 20, 40] as const;

const inflationInputs = (tariffRate: number): InflationInputs => ({
  unemployment: 5,
  gdpGrowth: 2,
  primeRate: 3,
  surplusToGdp: 0,
  tariffRate,
  wageGrowth: 2.5,
  commodityPressure: 0,
  forexPressure: 0,
  savingsPressure: 0,
  previousInflation: 2,
  policyStancePressure: 0,
});

function sourcedExposure(availabilityShare: number, tariffRatePct: number) {
  const localSupply = TOTAL_DEMAND * (1 - availabilityShare);
  const foreignSupply = TOTAL_DEMAND * availabilityShare;
  const balance = (supply: number, demand: number) => ({ supply, demand });
  const byState = new Map([
    ["A1", new Map([["coal" as CommodityType, balance(localSupply, TOTAL_DEMAND)]])],
  ]);
  const byCountry = new Map([
    ["US", new Map([["coal" as CommodityType, balance(localSupply, TOTAL_DEMAND)]])],
    ["UK", new Map([["coal" as CommodityType, balance(foreignSupply, 0)]])],
  ]);
  const input: SourcingInputs = {
    states: [{ stateId: "A1", countryId: "US" as CountryId }],
    byState,
    byCountry,
    statePricesFor: () => ({ A1: PRICE }),
    nationalPricesFor: () => ({ US: PRICE, UK: PRICE }),
    basePriceFor: () => PRICE,
    freightPrice: 0,
    hops: () => null,
    tariffRatePct: () => tariffRatePct,
    isBlocked: () => false,
    demandUsesByState: new Map([
      [
        "A1",
        new Map([["coal" as CommodityType, { householdFinal: TOTAL_DEMAND, productionInput: 0 }]]),
      ],
    ]),
  };
  const result = runSourcingPass(input);
  const exposure = result.purchaseExposureByCountry?.get("US")?.get("coal");
  if (!exposure) throw new Error("sourcing did not return US coal exposure");
  const tariff = tariffInflationExposure(
    {
      householdFinal: exposure.householdFinal,
      productionInput: exposure.productionInput,
    },
    true
  );
  const inflation = calculateInflationWithBreakdown(inflationInputs(tariff.tariffRate));
  const baselineCpi = calculateInflationWithBreakdown(
    inflationInputs(tariffInflationExposure(undefined, false).tariffRate)
  ).rate;
  return {
    requestedImportShare: availabilityShare,
    actualImportUnits: exposure.householdFinal.importUnits,
    actualImportShare: tariff.importShare,
    deliveredDuty: exposure.householdFinal.deliveredTariffPaid,
    tariffInput: tariff.tariffRate,
    tariffComponent: inflation.breakdown.tariff,
    cpiRate: inflation.rate,
    cpiChangeFromBaseline: inflation.rate - baselineCpi,
  };
}

const rows: Array<Record<string, string | number>> = [];
for (const share of importAvailabilityShares) {
  for (const rate of tariffRates) {
    const result = sourcedExposure(share, rate);
    rows.push({
      requested_import_availability: `${share * 100}%`,
      tariff_rate: `${rate}%`,
      delivered_import_share: `${(result.actualImportShare * 100).toFixed(1)}%`,
      delivered_import_units: result.actualImportUnits.toFixed(2),
      delivered_household_duty: result.deliveredDuty.toFixed(2),
      tariff_input: result.tariffInput.toFixed(3),
      raw_cpi_tariff_component: result.tariffComponent.toFixed(3),
      cpi_rate: result.cpiRate.toFixed(3),
      cpi_change_vs_baseline: result.cpiChangeFromBaseline.toFixed(3),
    });
  }
}

const columns = Object.keys(rows[0]);
console.log(`| ${columns.join(" | ")} |`);
console.log(`| ${columns.map(() => "---").join(" | ")} |`);
for (const row of rows) console.log(`| ${columns.map((column) => row[column]).join(" | ")} |`);
